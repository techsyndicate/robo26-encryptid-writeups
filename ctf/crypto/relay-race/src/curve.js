"use strict";

const crypto = require("crypto");

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 55066263022277343669578718895168534326250603453777594175500187360389116729240n,
  y: 32670510020758816978083085130507043184471273380659243275938904335757337482424n,
};

function mod(value, modulus = P) {
  const result = value % modulus;
  return result < 0n ? result + modulus : result;
}

function modInverse(value, modulus) {
  let oldR = mod(value, modulus);
  let r = modulus;
  let oldT = 1n;
  let t = 0n;

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldT, t] = [t, oldT - quotient * t];
  }

  if (oldR !== 1n) {
    throw new Error("inverse does not exist");
  }

  return mod(oldT, modulus);
}

function pointEquals(left, right) {
  return left === right || Boolean(left && right && left.x === right.x && left.y === right.y);
}

function pointAdd(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x && mod(left.y + right.y) === 0n) return null;

  let slope;
  if (pointEquals(left, right)) {
    slope = mod((3n * left.x * left.x) * modInverse(2n * left.y, P));
  } else {
    slope = mod((right.y - left.y) * modInverse(right.x - left.x, P));
  }

  const x = mod(slope * slope - left.x - right.x);
  const y = mod(slope * (left.x - x) - left.y);
  return { x, y };
}

function pointMultiply(scalar, point = G) {
  let factor = point;
  let value = mod(scalar, N);
  let result = null;

  while (value > 0n) {
    if (value & 1n) result = pointAdd(result, factor);
    factor = pointAdd(factor, factor);
    value >>= 1n;
  }

  return result;
}

function scalarToBuffer(value) {
  let remaining = mod(value, N);
  const output = Buffer.alloc(32);

  for (let offset = 31; offset >= 0; offset -= 1) {
    output[offset] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return output;
}

function scalarFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== 32) {
    throw new Error("scalar encoding must be 32 bytes");
  }

  const value = BigInt(`0x${buffer.toString("hex")}`);
  if (value === 0n || value >= N) throw new Error("invalid scalar");
  return value;
}

function pointToBuffer(point) {
  if (!point) throw new Error("point at infinity cannot be serialized");
  const output = Buffer.alloc(33);
  output[0] = point.y & 1n ? 3 : 2;

  let x = point.x;
  for (let offset = 32; offset >= 1; offset -= 1) {
    output[offset] = Number(x & 0xffn);
    x >>= 8n;
  }

  return output;
}

function pointToHex(point) {
  return pointToBuffer(point).toString("hex");
}

function pointFromHex(encoded) {
  if (typeof encoded !== "string" || !/^(02|03)[0-9a-f]{64}$/i.test(encoded)) {
    throw new Error("invalid compressed point encoding");
  }

  const bytes = Buffer.from(encoded, "hex");
  const x = BigInt(`0x${bytes.subarray(1).toString("hex")}`);
  if (x >= P) throw new Error("point x-coordinate is outside the field");

  const square = mod(x * x * x + 7n);
  let y = modPow(square, (P + 1n) / 4n, P);
  if (mod(y * y) !== square) throw new Error("point is not on secp256k1");
  if (Number(y & 1n) !== (bytes[0] & 1)) y = P - y;

  return { x, y };
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = mod(base, modulus);
  let power = exponent;

  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }

  return result;
}

function hashScalar(domain, ...parts) {
  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(domain, "utf8"));

  for (const part of parts) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }

  return mod(BigInt(`0x${hash.digest("hex")}`), N);
}

function deriveScalar(seed, label) {
  const bytes = crypto.createHmac("sha512", seed).update(label).digest();
  return mod(BigInt(`0x${bytes.toString("hex")}`), N - 1n) + 1n;
}

function sha256(...parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

module.exports = {
  G,
  N,
  P,
  deriveScalar,
  hashScalar,
  mod,
  modInverse,
  pointAdd,
  pointEquals,
  pointFromHex,
  pointMultiply,
  pointToBuffer,
  pointToHex,
  scalarFromBuffer,
  scalarToBuffer,
  sha256,
};
