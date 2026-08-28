import crypto from "crypto";
import { NITRO_BASE64 } from "./_data/bundle.data.js";

const SESSION_KEY = process.env.SESSION_SECRET || "";

function decode(v) {
  return Buffer.from(v, "base64url").toString("utf8");
}

function sign(payload) {
  return crypto.createHmac("sha256", SESSION_KEY).update(payload).digest("base64url");
}

function headerGet(req, name) {
  const h = req.headers ?? {};
  if (typeof h.get === "function") return h.get(name) ?? "";
  return h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()] ?? "";
}

function clientIp(req) {
  const xff = headerGet(req, "x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headerGet(req, "x-real-ip") || null;
}

function sessionOk(req) {
  if (!SESSION_KEY) return false;
  const raw = headerGet(req, "cookie").split(";").map((s) => s.trim())
    .find((s) => s.startsWith("nitro_sess="));
  if (!raw) return false;
  const value = raw.slice("nitro_sess=".length);
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const enc = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (mac !== sign(enc)) return false;
  let payload;
  try { payload = JSON.parse(decode(enc)); } catch { return false; }
  if (!payload || payload.v !== 1 || !payload.exp) return false;
  if (payload.exp <= Date.now()) return false;
  const fp = String(headerGet(req, "x-nitro-fp")).slice(0, 64);
  if (payload.fp && payload.fp !== fp) return false;
  const ip = clientIp(req);
  if (payload.ip && ip && payload.ip !== ip) return false;
  const ua = headerGet(req, "user-agent").slice(0, 256);
  if (payload.ua && ua && payload.ua !== ua) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "method_not_allowed" });
    return;
  }
  if (!sessionOk(req)) {
    res.status(403).json({ success: false, error: "human_check_required" });
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ success: true, data: NITRO_BASE64 });
}