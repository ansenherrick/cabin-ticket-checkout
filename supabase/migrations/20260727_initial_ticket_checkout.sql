create extension if not exists pgcrypto;

create type public.order_status as enum ('pending', 'paid', 'failed', 'expired');

create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents integer not null check (price_cents > 0),
  inventory_remaining integer not null check (inventory_remaining >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  status public.order_status not null default 'pending',
  ticket_type_id uuid not null references public.ticket_types(id),
  ticket_type_name text not null,
  unit_price_cents integer not null check (unit_price_cents > 0),
  quantity integer not null check (quantity > 0),
  customer_email text not null,
  customer_first_name text,
  customer_last_name text,
  customer_phone text,
  clover_checkout_session_id text unique,
  clover_payment_id text unique,
  checkout_expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  ticket_type_id uuid not null references public.ticket_types(id),
  issued_at timestamptz not null default now(),
  checked_in_at timestamptz
);

create index orders_clover_checkout_session_idx on public.orders(clover_checkout_session_id);
create index orders_pending_expiry_idx on public.orders(checkout_expires_at) where status = 'pending';
create index tickets_order_id_idx on public.tickets(order_id);

alter table public.ticket_types enable row level security;
alter table public.orders enable row level security;
alter table public.tickets enable row level security;

-- The browser never queries these tables directly. Vercel uses the service-role key.
revoke all on public.ticket_types, public.orders, public.tickets from anon, authenticated;

create or replace function public.reserve_ticket_order(
  p_ticket_type_id uuid,
  p_quantity integer,
  p_customer_email text,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_phone text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_ticket_type public.ticket_types;
  v_order_id uuid;
  v_expired_order public.orders;
begin
  -- On Hobby Vercel, no frequent cron is available. Releasing expired holds here
  -- keeps inventory accurate whenever a new customer begins checkout.
  for v_expired_order in
    update public.orders set status = 'expired'
    where status = 'pending' and checkout_expires_at <= now()
    returning *
  loop
    update public.ticket_types
    set inventory_remaining = inventory_remaining + v_expired_order.quantity
    where id = v_expired_order.ticket_type_id;
  end loop;

  if p_quantity < 1 or p_quantity > 10 then
    raise exception 'Ticket quantity is not available';
  end if;

  update public.ticket_types
  set inventory_remaining = inventory_remaining - p_quantity
  where id = p_ticket_type_id and is_active and inventory_remaining >= p_quantity
  returning * into v_ticket_type;
  if not found then
    raise exception 'Requested ticket quantity is not available';
  end if;

  insert into public.orders (
    ticket_type_id, ticket_type_name, unit_price_cents, quantity,
    customer_email, customer_first_name, customer_last_name, customer_phone
  ) values (
    v_ticket_type.id, v_ticket_type.name, v_ticket_type.price_cents, p_quantity,
    lower(p_customer_email), p_customer_first_name, p_customer_last_name, p_customer_phone
  ) returning id into v_order_id;
  return v_order_id;
end;
$$;

create or replace function public.release_ticket_order(p_order_id uuid) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  update public.orders set status = 'failed'
  where id = p_order_id and status = 'pending'
  returning * into v_order;
  if not found then return false; end if;
  update public.ticket_types set inventory_remaining = inventory_remaining + v_order.quantity where id = v_order.ticket_type_id;
  return true;
end;
$$;

create or replace function public.attach_clover_checkout_session(
  p_order_id uuid, p_clover_session_id text, p_checkout_expires_at timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.orders
  set clover_checkout_session_id = p_clover_session_id, checkout_expires_at = p_checkout_expires_at
  where id = p_order_id and status = 'pending';
  if not found then raise exception 'Pending order not found'; end if;
end;
$$;

create or replace function public.mark_order_paid(
  p_clover_session_id text, p_clover_payment_id text default null
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  update public.orders set status = 'paid', paid_at = now(), clover_payment_id = coalesce(p_clover_payment_id, clover_payment_id)
  where clover_checkout_session_id = p_clover_session_id and status = 'pending'
  returning * into v_order;
  if not found then return false; end if;
  insert into public.tickets (order_id, ticket_type_id)
  select v_order.id, v_order.ticket_type_id from generate_series(1, v_order.quantity);
  return true;
end;
$$;

create or replace function public.fail_ticket_order_by_checkout_session(p_clover_session_id text) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  update public.orders set status = 'failed'
  where clover_checkout_session_id = p_clover_session_id and status = 'pending'
  returning * into v_order;
  if not found then return false; end if;
  update public.ticket_types set inventory_remaining = inventory_remaining + v_order.quantity where id = v_order.ticket_type_id;
  return true;
end;
$$;

create or replace function public.release_expired_ticket_orders() returns integer
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders; v_released integer := 0;
begin
  for v_order in
    update public.orders set status = 'expired'
    where status = 'pending' and checkout_expires_at <= now()
    returning *
  loop
    update public.ticket_types set inventory_remaining = inventory_remaining + v_order.quantity where id = v_order.ticket_type_id;
    v_released := v_released + 1;
  end loop;
  return v_released;
end;
$$;

revoke all on function public.reserve_ticket_order(uuid, integer, text, text, text, text) from public;
revoke all on function public.release_ticket_order(uuid) from public;
revoke all on function public.attach_clover_checkout_session(uuid, text, timestamptz) from public;
revoke all on function public.mark_order_paid(text, text) from public;
revoke all on function public.fail_ticket_order_by_checkout_session(text) from public;
revoke all on function public.release_expired_ticket_orders() from public;

grant execute on function public.reserve_ticket_order(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.release_ticket_order(uuid) to service_role;
grant execute on function public.attach_clover_checkout_session(uuid, text, timestamptz) to service_role;
grant execute on function public.mark_order_paid(text, text) to service_role;
grant execute on function public.fail_ticket_order_by_checkout_session(text) to service_role;
grant execute on function public.release_expired_ticket_orders() to service_role;
