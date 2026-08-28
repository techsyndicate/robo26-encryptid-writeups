"use strict";

const MAX_HEADER_BYTES = 16384;
const MAX_BODY_BYTES = 8192;

function parseHeaderBlock(bytes) {
  const lines = bytes.toString("latin1").split("\r\n");
  const startLine = lines.shift();
  const headers = new Map();

  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("malformed HTTP header");
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(name, value);
  }

  return { startLine, headers };
}

function contentLength(headers) {
  const value = headers.get("content-length");
  if (value === undefined) return 0;
  if (!/^(0|[1-9][0-9]{0,4})$/.test(value)) throw new Error("invalid Content-Length");
  const length = Number(value);
  if (length > MAX_BODY_BYTES) throw new Error("request body exceeds edge limit");
  return length;
}

function readChunkedBody(buffer, offset) {
  const chunks = [];
  let cursor = offset;
  let total = 0;

  while (true) {
    const lineEnd = buffer.indexOf("\r\n", cursor, "latin1");
    if (lineEnd < 0) return null;
    const line = buffer.subarray(cursor, lineEnd).toString("latin1");
    const sizeText = line.split(";", 1)[0];
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) throw new Error("invalid chunk size");
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid chunk size");

    cursor = lineEnd + 2;
    if (buffer.length < cursor + size + 2) return null;
    if (buffer.subarray(cursor + size, cursor + size + 2).toString("latin1") !== "\r\n") {
      throw new Error("malformed chunk terminator");
    }

    if (size === 0) {
      return { body: Buffer.concat(chunks), end: cursor + 2 };
    }

    total += size;
    if (total > MAX_BODY_BYTES) throw new Error("request body exceeds origin limit");
    chunks.push(buffer.subarray(cursor, cursor + size));
    cursor += size + 2;
  }
}

class RequestParser {
  constructor(lengthMode) {
    this.lengthMode = lengthMode;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  take() {
    const headerEnd = this.buffer.indexOf("\r\n\r\n", 0, "latin1");
    if (headerEnd < 0) {
      if (this.buffer.length > MAX_HEADER_BYTES) throw new Error("headers are too large");
      return null;
    }

    const headerLength = headerEnd + 4;
    const { startLine, headers } = parseHeaderBlock(this.buffer.subarray(0, headerEnd));
    const requestLine = /^([A-Z]+) ([^ ]+) HTTP\/1\.[01]$/.exec(startLine);
    if (!requestLine) throw new Error("invalid request line");

    let parsedBody;
    if (this.lengthMode === "transfer" && /\bchunked\b/i.test(headers.get("transfer-encoding") || "")) {
      parsedBody = readChunkedBody(this.buffer, headerLength);
      if (!parsedBody) return null;
    } else {
      const length = contentLength(headers);
      if (this.buffer.length < headerLength + length) return null;
      parsedBody = {
        body: this.buffer.subarray(headerLength, headerLength + length),
        end: headerLength + length,
      };
    }

    const raw = this.buffer.subarray(0, parsedBody.end);
    this.buffer = this.buffer.subarray(parsedBody.end);
    return {
      body: parsedBody.body,
      headers,
      method: requestLine[1],
      path: requestLine[2],
      raw,
      startLine,
    };
  }
}

class ResponseParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  take() {
    const headerEnd = this.buffer.indexOf("\r\n\r\n", 0, "latin1");
    if (headerEnd < 0) return null;
    const headerLength = headerEnd + 4;
    const { startLine, headers } = parseHeaderBlock(this.buffer.subarray(0, headerEnd));
    if (!/^HTTP\/1\.1 [0-9]{3} /.test(startLine)) throw new Error("invalid origin response");
    const length = contentLength(headers);
    if (this.buffer.length < headerLength + length) return null;

    const raw = this.buffer.subarray(0, headerLength + length);
    this.buffer = this.buffer.subarray(headerLength + length);
    return { raw };
  }
}

function jsonResponse(status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const reasons = { 200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 413: "Payload Too Large" };
  const head = [
    `HTTP/1.1 ${status} ${reasons[status] || "Error"}`,
    "Content-Type: application/json; charset=utf-8",
    "Cache-Control: no-store",
    "Connection: keep-alive",
    `Content-Length: ${body.length}`,
    "",
    "",
  ].join("\r\n");
  return Buffer.concat([Buffer.from(head, "latin1"), body]);
}

module.exports = { RequestParser, ResponseParser, jsonResponse };
