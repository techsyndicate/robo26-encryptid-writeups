"use strict";

const crypto = require("crypto");

const {
  G,
  N,
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
  scalarToBuffer,
  sha256,
} = require("./curve");

const LOW_BITS = 40n;
const MIDDLE_BITS = 136n;
const UPPER_SHIFT = 176n;
const LOW_MASK = (1n << LOW_BITS) - 1n;
const ECDSA_RECORDS = 27;

function fixedLittleEndian(value, size) {
  const output = Buffer.alloc(size);
  let remaining = value;

  for (let index = 0; index < size; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  if (remaining !== 0n) throw new Error("window does not fit its fixed-width encoding");
  return output.toString("base64url");
}

function pointSum(points) {
  return points.reduce((total, point) => pointAdd(total, point), null);
}

function lagrangeAtZero(identifier, participants) {
  let numerator = 1n;
  let denominator = 1n;

  for (const other of participants) {
    if (other === identifier) continue;
    numerator = mod(numerator * -BigInt(other), N);
    denominator = mod(denominator * (BigInt(identifier) - BigInt(other)), N);
  }

  return mod(numerator * modInverse(denominator, N), N);
}

function encodedCommitments(commitments) {
  return Buffer.concat(commitments.flatMap((commitment) => [
    Buffer.from([commitment.id]),
    pointToBuffer(commitment.hiding),
    pointToBuffer(commitment.binding),
  ]));
}

function canonicalReleaseMessage(nonce, ticket) {
  return Buffer.from(`nonce=${nonce}\nticket=${ticket}`, "utf8");
}

function parseScalar(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,89}$/.test(value)) return null;
  const scalar = BigInt(value);
  return scalar < N ? scalar : null;
}

function buildState() {
  const configuredSeed = process.env.SIGNING_SEED;
  if (configuredSeed && !/^[0-9a-fA-F]{64}$/.test(configuredSeed)) {
    throw new Error("SIGNING_SEED must be exactly 32 bytes encoded as hexadecimal");
  }

  const seed = Buffer.from(configuredSeed || crypto.randomBytes(32).toString("hex"), "hex");
  const rootSecret = deriveScalar(seed, "frost/root-secret");
  const polynomialSlope = deriveScalar(seed, "frost/shamir-slope");
  const allParticipantIds = [1, 2, 3];
  const participantIds = [1, 2];
  const shares = new Map(allParticipantIds.map((id) => [
    id,
    mod(rootSecret + BigInt(id) * polynomialSlope, N),
  ]));

  const groupPublic = pointMultiply(rootSecret);
  const verificationShares = new Map([...shares].map(([id, share]) => [id, pointMultiply(share)]));
  const reusedNonces = new Map(participantIds.map((id) => [
    id,
    {
      hiding: deriveScalar(seed, `frost/recycled/${id}/hiding`),
      binding: deriveScalar(seed, `frost/recycled/${id}/binding`),
    },
  ]));

  const commitments = participantIds.map((id) => {
    const nonce = reusedNonces.get(id);
    return {
      id,
      hiding: pointMultiply(nonce.hiding),
      binding: pointMultiply(nonce.binding),
    };
  });
  const commitmentEncoding = encodedCommitments(commitments);

  function makeFrostSession(index) {
    const message = Buffer.from(`relay-audit/session/${index}`, "utf8");
    const factors = new Map(participantIds.map((id) => [
      id,
      hashScalar(
        "test",
        pointToBuffer(groupPublic),
        commitmentEncoding,
        message,
        Buffer.from([id]),
      ),
    ]));
    const groupCommitment = pointSum(commitments.map((commitment) => pointAdd(
      commitment.hiding,
      pointMultiply(factors.get(commitment.id), commitment.binding),
    )));
    const challenge = hashScalar(
      "relay/frost/challenge/v1",
      pointToBuffer(groupCommitment),
      pointToBuffer(groupPublic),
      message,
    );
    const partials = participantIds.map((id) => {
      const nonce = reusedNonces.get(id);
      const lambda = lagrangeAtZero(id, participantIds);
      const response = mod(
        nonce.hiding + factors.get(id) * nonce.binding + lambda * shares.get(id) * challenge,
        N,
      );
      return { id, response: response.toString() };
    });

    return {
      commitment: pointToHex(groupCommitment),
      message: message.toString("utf8"),
      partials,
    };
  }

  const frostArtifact = {
    curve: "secp256k1",
    groupPublic: pointToHex(groupPublic),
    groupInfo: {
      threshold: 2,
      verificationShares: allParticipantIds.map((id) => ({
        id,
        value: pointToHex(verificationShares.get(id)),
      })),
    },
    participants: commitments.map((commitment) => ({
      binding: pointToHex(commitment.binding),
      hiding: pointToHex(commitment.hiding),
      id: commitment.id,
      verificationShare: pointToHex(verificationShares.get(commitment.id)),
    })),
    sessions: [makeFrostSession(1), makeFrostSession(2), makeFrostSession(3)],
  };

  const proofBase = pointMultiply(123n);
  const proofRelation = pointMultiply(rootSecret, proofBase);
  const attestationNonce = sha256(seed, Buffer.from("dleq-attestation", "utf8")).subarray(0, 16).toString("hex");

  const recoverySecret = deriveScalar(seed, "recovery/ecdsa-secret");
  const recoveryPublic = pointMultiply(recoverySecret);
  const records = [];

  for (let index = 0; index < ECDSA_RECORDS; index += 1) {
    const message = Buffer.from(`recovery-log/${index}`, "utf8");
    const nonce = deriveScalar(seed, `recovery/ecdsa-nonce/${index}`);
    const noncePoint = pointMultiply(nonce);
    const r = mod(noncePoint.x, N);
    const digest = hashScalar("relay/ecdsa/message/v1", message);
    const s = mod(modInverse(nonce, N) * (digest + r * recoverySecret), N);
    const lower = nonce & LOW_MASK;
    const upper = nonce >> UPPER_SHIFT;

    records.push({
      message: message.toString("utf8"),
      r: r.toString(),
      s: s.toString(),
      trace: {
        carry: fixedLittleEndian(upper, 10),
        spill: fixedLittleEndian(lower, 5),
      },
    });
  }

  const releaseSecret = deriveScalar(seed, "release/delegation-secret");
  const releasePublic = pointMultiply(releaseSecret);
  const releaseTicket = sha256(seed, Buffer.from("release-ticket", "utf8")).subarray(0, 18).toString("base64url");
  const redemptionNonce = sha256(seed, Buffer.from("redemption-nonce", "utf8")).subarray(0, 18).toString("base64url");
  const ephemeral = deriveScalar(seed, "vault/ecies-ephemeral");
  const ephemeralPublic = pointMultiply(ephemeral);
  const shared = pointMultiply(ephemeral, recoveryPublic);
  const encryptionKey = sha256(Buffer.from("relay/ecies/aes-gcm/v1", "utf8"), pointToBuffer(shared));
  const iv = sha256(seed, Buffer.from("relay/ecies-iv", "utf8")).subarray(0, 12);
  const plaintext = Buffer.from(JSON.stringify({
    delegationScalar: scalarToBuffer(releaseSecret).toString("hex"),
    ticket: releaseTicket,
  }));
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const vaultArtifact = {
    curve: "secp256k1",
    ecies: {
      ciphertext: ciphertext.toString("base64url"),
      ephemeralPublic: pointToHex(ephemeralPublic),
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url"),
    },
    records,
    recoveryPublic: pointToHex(recoveryPublic),
  };

  function verifyDleqProof(body) {
    if (!body || body.nonce !== attestationNonce) return false;
    const response = parseScalar(body.response);
    if (response === null) return false;

    let firstCommitment;
    let secondCommitment;
    try {
      firstCommitment = pointFromHex(body.commitmentG);
      secondCommitment = pointFromHex(body.commitmentH);
    } catch {
      return false;
    }

    const challenge = hashScalar(
      "relay/dleq/v1",
      pointToBuffer(G),
      pointToBuffer(proofBase),
      pointToBuffer(groupPublic),
      pointToBuffer(proofRelation),
      pointToBuffer(firstCommitment),
      pointToBuffer(secondCommitment),
      Buffer.from(attestationNonce, "utf8"),
    );
    const firstCheck = pointEquals(
      pointMultiply(response),
      pointAdd(firstCommitment, pointMultiply(challenge, groupPublic)),
    );
    const secondCheck = pointEquals(
      pointMultiply(response, proofBase),
      pointAdd(secondCommitment, pointMultiply(challenge, proofRelation)),
    );
    return firstCheck && secondCheck;
  }

  function verifyRelease(body) {
    if (!body || body.nonce !== redemptionNonce || body.ticket !== releaseTicket) return false;
    const response = parseScalar(body.response);
    if (response === null) return false;

    let commitment;
    try {
      commitment = pointFromHex(body.commitment);
    } catch {
      return false;
    }

    const challenge = hashScalar(
      "relay/release-schnorr/v1",
      pointToBuffer(commitment),
      pointToBuffer(releasePublic),
      canonicalReleaseMessage(redemptionNonce, releaseTicket),
    );
    return pointEquals(
      pointMultiply(response),
      pointAdd(commitment, pointMultiply(challenge, releasePublic)),
    );
  }

  return {
    attestation: {
      baseH: pointToHex(proofBase),
      groupPublic: pointToHex(groupPublic),
      nonce: attestationNonce,
      relationPoint: pointToHex(proofRelation),
    },
    frostArtifact,
    lease: sha256(seed, Buffer.from("edge-lease", "utf8")).subarray(0, 18).toString("base64url"),
    publicRedemption: {
      nonce: redemptionNonce,
      releasePublic: pointToHex(releasePublic),
    },
    vaultArtifact,
    verifyDleqProof,
    verifyRelease,
  };
}

module.exports = { buildState };
