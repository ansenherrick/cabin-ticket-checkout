-- Store the purchaser's name and ticket quantity on the order only.
-- Apply after 20260804_ticket_holders.sql if that migration has already run.

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

revoke all on function public.record_approved_clover_payment(text, text) from public;
grant execute on function public.record_approved_clover_payment(text, text) to service_role;
