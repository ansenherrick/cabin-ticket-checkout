-- Apply this migration to the existing Supabase project before deploying the
-- matching Vercel code. It makes a browser checkout attempt idempotent and
-- records every approved Clover payment against exactly one order.

alter table public.orders add column if not exists checkout_attempt_id uuid;
alter table public.orders add column if not exists checkout_url text;

create unique index if not exists orders_checkout_attempt_id_unique_idx
on public.orders (checkout_attempt_id)
where checkout_attempt_id is not null;

create or replace function public.create_or_get_ticket_order(
  p_checkout_attempt_id uuid,
  p_ticket_type_id uuid,
  p_quantity integer,
  p_customer_email text,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_phone text default null
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
  if p_quantity < 1 or p_quantity > 10 then
    raise exception 'Ticket quantity is not available';
  end if;

  -- A successful retry must return the same live Clover checkout link.
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

  -- Release holds left by expired Clover sessions before checking availability.
  for v_expired_order in
    update public.orders
    set status = 'expired', checkout_attempt_id = null
    where status = 'pending' and checkout_expires_at <= now()
    returning *
  loop
    update public.ticket_types
    set inventory_remaining = inventory_remaining + v_expired_order.quantity
    where id = v_expired_order.ticket_type_id;
  end loop;

  -- Lock this ticket type. This serializes same-ticket attempts and lets the
  -- attempt ID be checked again after a concurrent request has finished.
  select * into v_ticket_type
  from public.ticket_types
  where id = p_ticket_type_id
  for update;
  if not found then
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

  if not v_ticket_type.is_active or v_ticket_type.inventory_remaining < p_quantity then
    raise exception 'Requested ticket quantity is not available';
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

  return query select v_order.id, v_order.checkout_url, v_order.checkout_expires_at,
    v_order.status, v_order.ticket_type_name, v_order.unit_price_cents, v_order.quantity;
end;
$$;

create or replace function public.attach_clover_checkout_session(
  p_order_id uuid,
  p_clover_session_id text,
  p_checkout_expires_at timestamptz,
  p_checkout_url text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.orders
  set
    clover_checkout_session_id = p_clover_session_id,
    checkout_expires_at = p_checkout_expires_at,
    checkout_url = p_checkout_url
  where id = p_order_id and status = 'pending';
  if not found then raise exception 'Pending order not found'; end if;
end;
$$;

create or replace function public.release_ticket_order(p_order_id uuid) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  update public.orders
  set status = 'failed', checkout_attempt_id = null
  where id = p_order_id and status = 'pending'
  returning * into v_order;
  if not found then return false; end if;
  update public.ticket_types
  set inventory_remaining = inventory_remaining + v_order.quantity
  where id = v_order.ticket_type_id;
  return true;
end;
$$;

create or replace function public.fail_ticket_order_by_checkout_session(p_clover_session_id text) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  update public.orders
  set status = 'failed', checkout_attempt_id = null
  where clover_checkout_session_id = p_clover_session_id and status = 'pending'
  returning * into v_order;
  if not found then return false; end if;
  update public.ticket_types
  set inventory_remaining = inventory_remaining + v_order.quantity
  where id = v_order.ticket_type_id;
  return true;
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

  if exists (
    select 1 from public.orders
    where clover_payment_id = p_clover_payment_id and id <> v_order.id
  ) then
    return 'payment_conflict';
  end if;

  update public.orders
  set status = 'paid', paid_at = now(), clover_payment_id = p_clover_payment_id
  where id = v_order.id;

  insert into public.tickets (order_id, ticket_type_id)
  select v_order.id, v_order.ticket_type_id
  from generate_series(1, v_order.quantity);
  return 'paid';
end;
$$;

revoke all on function public.create_or_get_ticket_order(uuid, uuid, integer, text, text, text, text) from public;
revoke all on function public.attach_clover_checkout_session(uuid, text, timestamptz, text) from public;
revoke all on function public.record_approved_clover_payment(text, text) from public;

grant execute on function public.create_or_get_ticket_order(uuid, uuid, integer, text, text, text, text) to service_role;
grant execute on function public.attach_clover_checkout_session(uuid, text, timestamptz, text) to service_role;
grant execute on function public.record_approved_clover_payment(text, text) to service_role;
