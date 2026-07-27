import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "../_lib/config.js";
import { supabaseAdmin } from "../_lib/supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (req.headers.authorization !== `Bearer ${config.cronSecret()}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const { data, error } = await supabaseAdmin().rpc("release_expired_ticket_orders");
  if (error) {
    console.error("Expired-order release failed", error);
    return res.status(500).json({ error: "Unable to release expired orders." });
  }
  return res.status(200).json({ released: data ?? 0 });
}
