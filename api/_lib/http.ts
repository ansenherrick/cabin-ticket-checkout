import type { VercelRequest, VercelResponse } from "@vercel/node";
import { config } from "./config.js";

export function setCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin;
  if (origin && origin !== config.allowedOrigin()) {
    res.status(403).json({ error: "Origin is not allowed." });
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", config.allowedOrigin());
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return true;
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== "OPTIONS") return false;
  res.status(204).end();
  return true;
}

export function methodNotAllowed(res: VercelResponse, allowed: string): void {
  res.setHeader("Allow", allowed);
  res.status(405).json({ error: "Method not allowed." });
}
