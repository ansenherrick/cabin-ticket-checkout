import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config as appConfig } from "../_lib/config.js";
import { methodNotAllowed } from "../_lib/http.js";
import { supabaseAdmin } from "../_lib/supabase.js";

export const config = { api: { bodyParser: false } };

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function signatureIsValid(signature: string | undefined, rawBody: Buffer): boolean {
  if (!signature) return false;
  const timestamp = signature.match(/(?:^|,)\s*t=(\d+)/)?.[1];
  const received = signature.match(/(?:^|,)\s*v1=([a-f0-9]+)/i)?.[1];
  if (!timestamp || !received) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const expected = createHmac("sha256", appConfig.cloverWebhookSecret())
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function nestedText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return nestedText(object.checkoutSessionId ?? object.checkout_session_id ?? object.id ?? "");
  }
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");

  try {
    const rawBody = await readRawBody(req);
    const signature = Array.isArray(req.headers["clover-signature"])
      ? req.headers["clover-signature"][0]
      : req.headers["clover-signature"];
    if (!signatureIsValid(signature, rawBody)) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    const type = String(payload.type ?? payload.Type ?? "").toUpperCase();
    const status = String(payload.status ?? payload.Status ?? "").toUpperCase();
    const checkoutSessionId = nestedText(payload.data ?? payload.Data);
    const paymentId = nestedText(payload.id ?? payload.Id);

    if (type !== "PAYMENT" || !checkoutSessionId) return res.status(200).json({ received: true });

    const supabase = supabaseAdmin();
    if (status === "APPROVED") {
      const { data: outcome, error } = await supabase.rpc("record_approved_clover_payment", {
        p_clover_session_id: checkoutSessionId,
        p_clover_payment_id: paymentId || null
      });
      if (error) throw error;
      if (outcome !== "paid" && outcome !== "already_paid") {
        console.error("Approved Clover payment could not be reconciled", {
          checkoutSessionId,
          paymentId,
          outcome
        });
        return res.status(500).json({ error: "Approved payment could not be reconciled." });
      }
    } else if (status === "DECLINED") {
      const { error } = await supabase.rpc("fail_ticket_order_by_checkout_session", {
        p_clover_session_id: checkoutSessionId
      });
      if (error) throw error;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Clover webhook processing failed", error);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
}
