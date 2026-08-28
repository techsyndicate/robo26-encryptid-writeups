"use strict";

const net = require("net");

const { buildState } = require("./crypto-state");
const { RequestParser, jsonResponse } = require("./http-wire");

const PORT = Number(process.env.PORT1 || 3000);
const FLAG = process.env.FLAG || "encryptid{heehee}";
const state = buildState();

function parseJsonBody(request) {
  try {
    return JSON.parse(request.body.toString("utf8"));
  } catch {
    return null;
  }
}

function route(request) {
  const resource = request.path.split("?", 1)[0];

  if (request.method === "GET" && resource === "/") {
    return jsonResponse(200, {
      service: "Relay Race",
      status: "public release relay",
    });
  }

  if (request.method === "GET" && resource === "/api/ping") {
    return jsonResponse(200, { ok: true });
  }

  if (request.method === "POST" && resource === "/api/warmup") {
    return jsonResponse(200, { status: "relay warmed" });
  }

  if (request.method === "GET" && resource === "/internal/lease") {
    return jsonResponse(200, { lease: state.lease, scope: "relay-preview" });
  }

  if (request.method === "GET" && resource === "/assets/policy.mjs") {
    return jsonResponse(200, {
      format: "relay-policy/v1",
      mode: request.headers.get("x-relay-mode") || "audit",
    });
  }

  if (request.method === "POST" && resource === "/api/relay") {
    const body = parseJsonBody(request);
    if (!body || body.lease !== state.lease) {
      return jsonResponse(403, { error: "invalid relay lease" });
    }
    if (request.headers.get("x-relay-policy") !== "frost-trace") {
      return jsonResponse(403, { error: "relay policy has not enabled trace delivery" });
    }
    if (body.operation === "audit") {
      return jsonResponse(200, { status: "audit accepted", retained: false });
    }
    if (body.operation === "frost-trace") {
      return jsonResponse(200, state.frostArtifact);
    }
    return jsonResponse(403, { error: "relay operation is not permitted" });
  }

  if (request.method === "GET" && resource === "/api/attestation") {
    return jsonResponse(200, state.attestation);
  }

  if (request.method === "POST" && resource === "/api/vault") {
    const body = parseJsonBody(request);
    if (!state.verifyDleqProof(body)) {
      return jsonResponse(403, { error: "DLEQ attestation rejected" });
    }
    return jsonResponse(200, state.vaultArtifact);
  }

  if (request.method === "GET" && resource === "/api/redemption") {
    return jsonResponse(200, state.publicRedemption);
  }

  if (request.method === "POST" && resource === "/api/redeem") {
    const body = parseJsonBody(request);
    if (!state.verifyRelease(body)) {
      return jsonResponse(403, { error: "release authorization rejected" });
    }
    return jsonResponse(200, { flag: FLAG });
  }

  return jsonResponse(404, { error: "not found" });
}

const server = net.createServer((socket) => {
  const parser = new RequestParser("transfer");
  socket.setNoDelay(true);

  socket.on("data", (chunk) => {
    try {
      parser.push(chunk);
      let request;
      while ((request = parser.take()) !== null) {
        socket.write(route(request));
      }
    } catch (error) {
      socket.write(jsonResponse(400, { error: error.message }));
      socket.end();
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`relay origin listening on 127.0.0.1:${PORT}`);
});
