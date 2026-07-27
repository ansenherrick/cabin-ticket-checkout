import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleOptions, methodNotAllowed, setCors } from "./_lib/http.js";
import { supabaseAdmin } from "./_lib/supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!setCors(req, res) || handleOptions(req, res)) return;
  if (req.method !== "GET") return methodNotAllowed(res, "GET, OPTIONS");

  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : undefined;
  if (!sessionId) return res.status(400).json({ error: "A checkout session ID is required." });

  const supabase = supabaseAdmin();
  const { data: order, error } = await supabase
    .from("orders")
    .select("public_id, status, ticket_type_name, quantity, tickets(public_id)")
    .eq("clover_checkout_session_id", sessionId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: "Unable to look up the order." });
  if (!order) return res.status(404).json({ error: "Order not found." });

  return res.status(200).json({
    orderId: order.public_id,
    status: order.status,
    ticketType: order.ticket_type_name,
    quantity: order.quantity,
    ticketIds: order.status === "paid" ? order.tickets.map((ticket) => ticket.public_id) : []
  });
}
