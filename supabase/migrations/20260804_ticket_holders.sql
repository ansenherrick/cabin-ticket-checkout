-- Store one named attendee for each ticket. Apply this after the checkout
-- safety migration and before deploying the matching API and Framer component.

create table if not exists public.order_attendees (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  position integer not null check (position > 0),
  first_name text not null check (char_length(first_name) <= 100),
  last_name text not null check (char_length(last_name) <= 100),
  created_at timestamptz not null default now(),
  unique (order_id, position)
);

alter table public.tickets add column if not exists holder_first_name text;
alter table public.tickets add column if not exists holder_last_name text;

create index if not exists order_attendees_order_id_idx on public.order_attendees(order_id);
alter table public.order_attendees enable row level security;
revoke all on public.order_attendees from anon, authenticated;

create or replace function public.create_or_get_ticket_order_with_attendees(
  p_checkout_attempt_id uuid,
  p_ticket_type_id uuid,
  p_quantity integer,
  p_customer_email text,
  p_customer_first_name text,
  p_customer_last_name text,
  p_customer_phone text,
  p_attendees jsonb
) returns table(
  order_id uuid,
  checkout_url text,
  checkout_expires_at timestamptz,
  order_status public.order_status,
  ticket_type_name text,
  unit_price_cents integer,
  quantity integer
)
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_ticket_type public.ticket_types;
  v_expired_order public.orders;
begin
  if p_quantity < 1 or p_quantity > 10
    or jsonb_typeof(p_attendees) <> 'array'
    or jsonb_array_length(p_attendees) <> p_quantity then
    raise exception 'A complete ticket-holder name is required for every ticket';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_attendees) as attendee
    where nullif(btrim(attendee->>'firstName'), '') is null
       or nullif(btrim(attendee->>'lastName'), '') is null
       or char_length(attendee->>'firstName') > 100
       or char_length(attendee->>'lastName') > 100
  ) then
    raise exception 'A complete ticket-holder name is required for every ticket';
  end if;

  select * into v_order
  from public.orders
  where checkout_attempt_id = p_checkout_attempt_id;
  if found then
    if v_order.status = 'pending' and v_order.checkout_url is not null and v_order.checkout_expires_at <= now() then
      update public.orders
      set status = 'expired', checkout_attempt_id = null
      where id = v_order.id;
      update public.ticket_types
      set inventory_remaining = inventory_remaining + v_order.quantity
      where id = v_order.ticket_type_id;
    else
      return query select v_order.id, v_order.checkout_url, v_order.checkout_expires_at,
        v_order.status, v_order.ticket_type_name, v_order.unit_price_cents, v_order.quantity;
      return;
    end if;
  end if;

  for v_expired_order in
    update public.orders as expired_order
    set status = 'expired', checkout_attempt_id = null
    where expired_order.status = 'pending' and expired_order.checkout_expires_at <= now()
    returning expired_order.*
  loop
    update public.ticket_types
    set inventory_remaining = inventory_remaining + v_expired_order.quantity
    where id = v_expired_order.ticket_type_id;
  end loop;

  select * into v_ticket_type
  from public.ticket_types
  where id = p_ticket_type_id
  for update;
  if not found or not v_ticket_type.is_active or v_ticket_type.inventory_remaining < p_quantity then
    raise exception 'Requested ticket quantity is not available';
  end if;

  select * into v_order
  from public.orders
  where checkout_attempt_id = p_checkout_attempt_id;
  if found then
    return query select v_order.id, v_order.checkout_url, v_order.checkout_expires_at,
      v_order.status, v_order.ticket_type_name, v_order.unit_price_cents, v_order.quantity;
    return;
  end if;

  update public.ticket_types
  set inventory_remaining = inventory_remaining - p_quantity
  where id = v_ticket_type.id;

  insert into public.orders (
    checkout_attempt_id, ticket_type_id, ticket_type_name, unit_price_cents, quantity,
    customer_email, customer_first_name, customer_last_name, customer_phone
  ) values (
    p_checkout_attempt_id, v_ticket_type.id, v_ticket_type.name, v_ticket_type.price_cents, p_quantity,
    lower(p_customer_email), p_customer_first_name, p_customer_last_name, p_customer_phone
  ) returning * into v_order;

  insert into public.order_attendees (order_id, position, first_name, last_name)
  select
    v_order.id,
    attendee.position,
    btrim(attendee.value->>'firstName'),
    btrim(attendee.value->>'lastName')
  from jsonb_array_elements(p_attendees) with ordinality as attendee(value, position);

  return query select v_order.id, v_order.checkout_url, v_order.checkout_expires_at,
    v_order.status, v_order.ticket_type_name, v_order.unit_price_cents, v_order.quantity;
end;
$$;

create or replace function public.record_approved_clover_payment(
  p_clover_session_id text,
  p_clover_payment_id text
) returns text
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if p_clover_payment_id is null or length(p_clover_payment_id) = 0 then
    return 'missing_payment_id';
  end if;

  select * into v_order
  from public.orders
  where clover_checkout_session_id = p_clover_session_id
  for update;
  if not found then return 'order_not_found'; end if;

  if v_order.status = 'paid' then
    if v_order.clover_payment_id = p_clover_payment_id then return 'already_paid'; end if;
    return 'payment_conflict';
  end if;
  if v_order.status <> 'pending' then return 'order_not_pending'; end if;

  if (select count(*) from public.order_attendees where order_id = v_order.id) <> v_order.quantity then
    return 'attendee_count_mismatch';
  end if;

  if exists (
    select 1 from public.orders
    where clover_payment_id = p_clover_payment_id and id <> v_order.id
  ) then
    return 'payment_conflict';
  end if;

  update public.orders
  set status = 'paid', paid_at = now(), clover_payment_id = p_clover_payment_id
  where id = v_order.id;

  insert into public.tickets (order_id, ticket_type_id, holder_first_name, holder_last_name)
  select v_order.id, v_order.ticket_type_id, attendee.first_name, attendee.last_name
  from public.order_attendees as attendee
  where attendee.order_id = v_order.id
  order by attendee.position;
  return 'paid';
end;
$$;

revoke all on function public.create_or_get_ticket_order_with_attendees(uuid, uuid, integer, text, text, text, text, jsonb) from public;
revoke all on function public.record_approved_clover_payment(text, text) from public;
grant execute on function public.create_or_get_ticket_order_with_attendees(uuid, uuid, integer, text, text, text, text, jsonb) to service_role;
grant execute on function public.record_approved_clover_payment(text, text) to service_role;
