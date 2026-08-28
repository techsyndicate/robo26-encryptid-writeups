"use strict";

const net = require("net");

const { RequestParser, ResponseParser, jsonResponse } = require("./http-wire");

const PORT2 = Number(process.env.PORT2 || 8080);
const PORT1 = Number(process.env.PORT1 || 3000);
const POLICY_TTL_MS = 90_000;
const MAX_POLICY_ENTRIES = 96;
const policyCache = new Map();

function firstOperation(body) {
  const match = /"operation"\s*:\s*"([^"\\]{1,64})"/.exec(body.toString("utf8"));
  return match ? match[1] : null;
}

function policyKey(pathname) {
  let parsed;
  try {
    parsed = new URL(pathname, "http://relay.invalid");
  } catch {
    return null;
  }

  if (parsed.pathname !== "/assets/policy.mjs") return null;
  if ([...parsed.searchParams.keys()].join(",") !== "bucket") return null;
  const bucket = parsed.searchParams.get("bucket");
  if (!/^[a-z0-9]{12,20}$/.test(bucket || "")) return null;
  return `/assets/policy.mjs?bucket=${bucket}`;
}

function relayBucket(pathname) {
  let parsed;
  try {
    parsed = new URL(pathname, "http://relay.invalid");
  } catch {
    return null;
  }

  if (parsed.pathname !== "/api/relay") return null;
  if ([...parsed.searchParams.keys()].join(",") !== "bucket") return null;
  const bucket = parsed.searchParams.get("bucket");
  return /^[a-z0-9]{12,20}$/.test(bucket || "") ? bucket : null;
}

function prunePolicyCache() {
  const now = Date.now();
  for (const [key, entry] of policyCache) {
    if (entry.expiresAt <= now) policyCache.delete(key);
  }
  while (policyCache.size > MAX_POLICY_ENTRIES) {
    policyCache.delete(policyCache.keys().next().value);
  }
}

function withHeader(raw, name, value) {
  const marker = raw.indexOf("\r\n\r\n", 0, "latin1");
  if (marker < 0) throw new Error("cannot attach edge metadata to an incomplete request");
  return Buffer.concat([
    raw.subarray(0, marker),
    Buffer.from(`\r\n${name}: ${value}`, "latin1"),
    raw.subarray(marker),
  ]);
}

function blocked(request) {
  if (request.path.startsWith("/internal/")) {
    return jsonResponse(403, { error: "internal routes are not exposed by the relay edge" });
  }

  if (request.method === "POST" && request.path.split("?", 1)[0] === "/api/relay" && firstOperation(request.body) !== "audit") {
    return jsonResponse(403, { error: "edge policy permits audit relay requests only" });
  }

  return null;
}

const edge = net.createServer((client) => {
  const inbound = new RequestParser("content-length");
  const outbound = new ResponseParser();
  const origin = net.connect({ host: "127.0.0.1", port: PORT1 });
  const responseQueue = [];
  let outstanding = 0;
  let closed = false;

  function closeBoth() {
    if (closed) return;
    closed = true;
    origin.destroy();
    client.destroy();
  }

  function flushResponses() {
    while (outstanding > 0 && responseQueue.length > 0 && !client.destroyed) {
      client.write(responseQueue.shift());
      outstanding -= 1;
    }
  }

  client.setNoDelay(true);
  origin.setNoDelay(true);

  client.on("data", (chunk) => {
    try {
      inbound.push(chunk);
      let request;
      while ((request = inbound.take()) !== null) {
        const denied = blocked(request);
        if (denied) {
          client.write(denied);
          continue;
        }

        prunePolicyCache();
        const key = request.method === "GET" ? policyKey(request.path) : null;
        if (key) {
          const cached = policyCache.get(key);
          if (cached) {
            client.write(jsonResponse(200, {
              bucket: key.slice(key.indexOf("=") + 1),
              cache: "HIT",
              format: "relay-policy/v1",
              mode: cached.mode,
            }));
            continue;
          }

          const mode = request.headers.get("x-relay-mode") || "audit";
          if (!["audit", "frost-trace", "recovery-export"].includes(mode)) {
            client.write(jsonResponse(400, { error: "unsupported relay policy mode" }));
            continue;
          }
          policyCache.set(key, { expiresAt: Date.now() + POLICY_TTL_MS, mode });
        }

        let outboundRequest = request.raw;
        if (request.method === "POST" && request.path.split("?", 1)[0] === "/api/relay") {
          const bucket = relayBucket(request.path);
          const cached = bucket && policyCache.get(`/assets/policy.mjs?bucket=${bucket}`);
          if (!cached) {
            client.write(jsonResponse(403, { error: "relay policy cache miss" }));
            continue;
          }
          outboundRequest = withHeader(outboundRequest, "X-Relay-Policy", cached.mode);
        }
        outstanding += 1;
        origin.write(outboundRequest);
      }
      flushResponses();
    } catch (error) {
      client.write(jsonResponse(400, { error: error.message }));
      closeBoth();
    }
  });

  origin.on("data", (chunk) => {
    try {
      outbound.push(chunk);
      let response;
      while ((response = outbound.take()) !== null) responseQueue.push(response.raw);
      flushResponses();
    } catch {
      closeBoth();
    }
  });

  client.on("error", closeBoth);
  client.on("end", () => origin.end());
  client.on("close", () => origin.destroy());
  origin.on("error", closeBoth);
  origin.on("close", () => {
    if (!client.destroyed) client.end();
  });
});

edge.listen(PORT2, "0.0.0.0", () => {
  console.log(`relay edge listening on 0.0.0.0:${PORT2}`);
});
