import crypto from "crypto";

const SESSION_KEY = process.env.SESSION_SECRET || "";
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || "";
const MAX_AGE = 30 * 60 * 1000;

function sign(payload) {
  return crypto.createHmac("sha256", SESSION_KEY).update(payload).digest("base64url");
}

function encode(v) {
  return Buffer.from(v).toString("base64url");
}

function decode(v) {
  return Buffer.from(v, "base64url").toString("utf8");
}

function cookieFor(payload) {
  const enc = encode(payload);
  return `nitro_sess=${enc}.${sign(enc)}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${MAX_AGE / 1000}`;
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

function browserSignalsOk(req) {
  const sfs = headerGet(req, "sec-fetch-site").toLowerCase();
  if (sfs && !["same-origin", "same-site"].includes(sfs)) return false;
  const dest = headerGet(req, "sec-fetch-dest").toLowerCase();
  if (dest && !["empty", "document"].includes(dest)) return false;
  const origin = headerGet(req, "origin").replace(/^https?:\/\//, "").split("/")[0];
  if (origin && !origin.endsWith(".squeakyfiddlepro.me") && origin !== "squeakyfiddlepro.me") return false;
  return true;
}

const ALLOWED_HOSTS = new Set(
  (process.env.RECAPTCHA_ALLOWED_HOSTS || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
);

function hostAllowed(hostname) {
  if (!ALLOWED_HOSTS.size) return true;
  for (const h of ALLOWED_HOSTS) {
    if (h === hostname) return true;
    if (h.startsWith("*.") && hostname.endsWith(h.slice(1))) return true;
  }
  return false;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) return req.body;
  try {
    if (typeof req.text === "function") {
      const t = await req.text();
      if (t) return JSON.parse(t);
    }
  } catch { /* */ }
  try {
    if (req.body && typeof req.body.getReader === "function") {
      const t = await new Response(req.body).text();
      if (t) return JSON.parse(t);
    }
  } catch { /* */ }
  return {};
}

async function verifyRecaptcha(token) {
  if (!token || !RECAPTCHA_SECRET) return { ok: false, reason: "not_configured" };
  try {
    const params = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token });
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      body: params,
    });
    const j = await r.json();
    if (!j) return { ok: false, reason: "no_response" };
    if (!j.success) {
      return { ok: false, reason: "google:" + (j["error-codes"] || ["unknown"]).join(",") };
    }
    if (j.hostname && !hostAllowed(j.hostname)) {
      return { ok: false, reason: "hostname:" + j.hostname };
    }
    return { ok: true, reason: "" };
  } catch (e) {
    return { ok: false, reason: "fetch_error" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "method_not_allowed" });
    return;
  }
  if (!SESSION_KEY) {
    res.status(500).json({ success: false, error: "session_not_configured" });
    return;
  }

  const body = await readBody(req);
  const fp = String(body.fp || headerGet(req, "x-nitro-fp") || "").slice(0, 64);
  if (fp && !/^fp_[0-9a-z_]+$/i.test(fp)) {
    res.status(403).json({ success: false, error: "human_check_failed", reason: "missing_fingerprint" });
    return;
  }

  if (!browserSignalsOk(req)) {
    res.status(403).json({ success: false, error: "human_check_failed", reason: "browser_signals" });
    return;
  }

  const recapToken = body.recaptcha ?? "";

  const ok = await verifyRecaptcha(recapToken);
  if (!ok.ok) {
    res.status(403).json({ success: false, error: "human_check_failed", reason: ok.reason });
    return;
  }

  const ip = clientIp(req);
  const ua = headerGet(req, "user-agent").slice(0, 256);
  const payload = JSON.stringify({
    v: 1,
    iat: Date.now(),
    exp: Date.now() + MAX_AGE,
    nonce: crypto.randomBytes(8).toString("hex"),
    via: "recaptcha",
    fp,
    ip: ip || null,
    ua,
  });
  res.setHeader("Set-Cookie", cookieFor(payload));
  res.status(200).json({ success: true });
}