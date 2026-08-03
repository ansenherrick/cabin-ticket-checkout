import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createCloverCheckout } from "./_lib/clover.js";
import { handleOptions, methodNotAllowed, setCors } from "./_lib/http.js";
import { supabaseAdmin } from "./_lib/supabase.js";

type CheckoutRequest = {
  checkoutAttemptId?: unknown;
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

function asUuid(value: unknown): string | undefined {
  const text = asText(value, 36);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!setCors(req, res) || handleOptions(req, res)) return;
  if (req.method !== "POST") return methodNotAllowed(res, "POST, OPTIONS");

  const body = (req.body ?? {}) as CheckoutRequest;
  const checkoutAttemptId = asUuid(body.checkoutAttemptId);
  const ticketTypeId = asText(body.ticketTypeId, 100);
  const quantity = body.quantity;
  const email = asText(body.customer?.email, 254);
  const firstName = asText(body.customer?.firstName, 100);
  const lastName = asText(body.customer?.lastName, 100);
  const phoneNumber = asText(body.customer?.phoneNumber, 30);

  if (!checkoutAttemptId || !ticketTypeId || !Number.isInteger(quantity) || typeof quantity !== "number" || quantity < 1 || quantity > 10 || !email) {
    return res.status(400).json({ error: "Enter a valid checkout attempt, ticket type, quantity (1–10), and email." });
  }

  const supabase = supabaseAdmin();
  const { data: reservation, error: reservationError } = await supabase.rpc("create_or_get_ticket_order", {
    p_checkout_attempt_id: checkoutAttemptId,
    p_ticket_type_id: ticketTypeId,
    p_quantity: quantity,
    p_customer_email: email,
    p_customer_first_name: firstName ?? null,
    p_customer_last_name: lastName ?? null,
    p_customer_phone: phoneNumber ?? null
  });

  if (reservationError || !reservation?.[0]) {
    const soldOut = reservationError?.message.includes("not available");
    return res.status(soldOut ? 409 : 500).json({
      error: soldOut ? "Those tickets are no longer available." : "Unable to reserve tickets."
    });
  }

  const order = reservation[0] as {
    order_id: string;
    checkout_url: string | null;
    checkout_expires_at: string;
    order_status: "pending" | "paid" | "failed" | "expired";
    ticket_type_name: string;
    unit_price_cents: number;
    quantity: number;
  };

  if (order.order_status === "pending" && order.checkout_url && new Date(order.checkout_expires_at).getTime() > Date.now()) {
    return res.status(200).json({ checkoutUrl: order.checkout_url });
  }

  if (order.order_status !== "pending" || order.checkout_url) {
    return res.status(409).json({ error: "This checkout attempt is no longer available. Please try again." });
  }

  try {
    const checkout = await createCloverCheckout({
      customer: { email, ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(phoneNumber ? { phoneNumber } : {}) },
      item: { name: order.ticket_type_name, price: order.unit_price_cents, unitQty: order.quantity }
    });

    const { error: updateError } = await supabase.rpc("attach_clover_checkout_session", {
      p_order_id: order.order_id,
      p_clover_session_id: checkout.checkoutSessionId,
      p_checkout_expires_at: new Date(checkout.expirationTime).toISOString(),
      p_checkout_url: checkout.href
    });
    if (updateError) throw updateError;

    return res.status(201).json({ checkoutUrl: checkout.href });
  } catch (error) {
    await supabase.rpc("release_ticket_order", { p_order_id: order.order_id });
    console.error("Checkout session creation failed", error);
    return res.status(502).json({ error: "Unable to start Clover checkout. Please try again." });
  }
}
