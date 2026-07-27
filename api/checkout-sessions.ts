import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createCloverCheckout } from "./_lib/clover.js";
import { handleOptions, methodNotAllowed, setCors } from "./_lib/http.js";
import { supabaseAdmin } from "./_lib/supabase.js";

type CheckoutRequest = {
  ticketTypeId?: unknown;
  quantity?: unknown;
  customer?: {
    email?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    phoneNumber?: unknown;
  };
};

function asText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!setCors(req, res) || handleOptions(req, res)) return;
  if (req.method !== "POST") return methodNotAllowed(res, "POST, OPTIONS");

  const body = (req.body ?? {}) as CheckoutRequest;
  const ticketTypeId = asText(body.ticketTypeId, 100);
  const quantity = body.quantity;
  const email = asText(body.customer?.email, 254);
  const firstName = asText(body.customer?.firstName, 100);
  const lastName = asText(body.customer?.lastName, 100);
  const phoneNumber = asText(body.customer?.phoneNumber, 30);

  if (!ticketTypeId || !Number.isInteger(quantity) || typeof quantity !== "number" || quantity < 1 || quantity > 10 || !email) {
    return res.status(400).json({ error: "Enter a valid ticket type, quantity (1–10), and email." });
  }

  const supabase = supabaseAdmin();
  const { data: reservedOrderId, error: reservationError } = await supabase.rpc("reserve_ticket_order", {
    p_ticket_type_id: ticketTypeId,
    p_quantity: quantity,
    p_customer_email: email,
    p_customer_first_name: firstName ?? null,
    p_customer_last_name: lastName ?? null,
    p_customer_phone: phoneNumber ?? null
  });

  if (reservationError || !reservedOrderId) {
    const soldOut = reservationError?.message.includes("not available");
    return res.status(soldOut ? 409 : 500).json({
      error: soldOut ? "Those tickets are no longer available." : "Unable to reserve tickets."
    });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, ticket_type_name, unit_price_cents, quantity")
    .eq("id", reservedOrderId)
    .single();

  if (orderError || !order) {
    await supabase.rpc("release_ticket_order", { p_order_id: reservedOrderId });
    return res.status(500).json({ error: "Unable to prepare your order." });
  }

  try {
    const checkout = await createCloverCheckout({
      customer: { email, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(phoneNumber ? { phoneNumber } : {}) },
      item: { name: order.ticket_type_name, price: order.unit_price_cents, unitQty: order.quantity }
    });

    const { error: updateError } = await supabase.rpc("attach_clover_checkout_session", {
      p_order_id: order.id,
      p_clover_session_id: checkout.checkoutSessionId,
      p_checkout_expires_at: new Date(checkout.expirationTime).toISOString()
    });
    if (updateError) throw updateError;

    return res.status(201).json({ checkoutUrl: checkout.href });
  } catch (error) {
    await supabase.rpc("release_ticket_order", { p_order_id: order.id });
    console.error("Checkout session creation failed", error);
    return res.status(502).json({ error: "Unable to start Clover checkout. Please try again." });
  }
}
