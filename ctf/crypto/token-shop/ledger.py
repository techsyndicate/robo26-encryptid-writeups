from __future__ import annotations

import base64
import binascii
import hashlib
import json
import random
import secrets
import time
from typing import Any

FIELD = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GENERATOR = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)
Point = tuple[int, int] | None

SEAL_DOMAIN = b"token-shop/seal-v4\x00"
PRIVATE_KEY = secrets.randbelow(ORDER - 1) + 1
CURVATURE = int.from_bytes(hashlib.sha256(b"token-shop/qcg/quadratic").digest(), "big") % ORDER
DRIFT = int.from_bytes(hashlib.sha256(b"token-shop/qcg/linear").digest(), "big") % ORDER


def inverse(value: int, modulus: int) -> int:
    return pow(value % modulus, -1, modulus)


def add(left: Point, right: Point) -> Point:
    if left is None:
        return right
    if right is None:
        return left

    x1, y1 = left
    x2, y2 = right
    if x1 == x2 and (y1 + y2) % FIELD == 0:
        return None
    if left == right:
        slope = 3 * x1 * x1 * inverse(2 * y1, FIELD) % FIELD
    else:
        slope = (y2 - y1) * inverse(x2 - x1, FIELD) % FIELD
    x3 = (slope * slope - x1 - x2) % FIELD
    return x3, (slope * (x1 - x3) - y1) % FIELD


def multiply(scalar: int, point: Point = GENERATOR) -> Point:
    result: Point = None
    cursor = point
    while scalar:
        if scalar & 1:
            result = add(result, cursor)
        cursor = add(cursor, cursor)
        scalar >>= 1
    return result


PUBLIC_KEY = multiply(PRIVATE_KEY)
assert PUBLIC_KEY is not None


class TicketSequence:
    def __init__(self) -> None:
        self.increment = secrets.randbelow(ORDER - 1) + 1
        self.state = secrets.randbelow(ORDER - 1) + 1

    def next_scalar(self) -> int:
        self.state = (
            CURVATURE * self.state * self.state
            + DRIFT * self.state
            + self.increment
        ) % ORDER
        if self.state == 0:
            self.state = self.increment
        return self.state


TICKET_SEQUENCE = TicketSequence()


def canonical_bytes(document: dict[str, Any]) -> bytes:
    return json.dumps(document, sort_keys=True, separators=(",", ":")).encode()


def encode_bytes(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode_bytes(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def digest(raw: bytes) -> int:
    return int.from_bytes(hashlib.sha256(SEAL_DOMAIN + raw).digest(), "big")


def seal(document: dict[str, Any]) -> str:
    raw = canonical_bytes(document)
    nonce = TICKET_SEQUENCE.next_scalar()
    point = multiply(nonce)
    assert point is not None
    r = point[0] % ORDER
    s = inverse(nonce, ORDER) * (digest(raw) + r * PRIVATE_KEY) % ORDER
    if r == 0 or s == 0:
        raise RuntimeError("printer produced an unusable seal; retry the request")

    if s > ORDER // 2:
        s = ORDER - s
    return f"{encode_bytes(raw)}.{r:064x}.{s:064x}"


def mint_token_bundle(username: str) -> list[str]:
    issued = int(time.time())
    reference = secrets.token_hex(8)
    bundle = [seal(
        {
            "username": username,
            "issued": issued,
            "role": "customer",
            "reference": reference,
            "series": "token-shop-v4",
        }
    )]
    token_types = ["bronze", "silver", "gold", "platinum"]
    random.SystemRandom().shuffle(token_types)
    for token_type in token_types:
        bundle.append(
            seal(
                {
                    "username": username,
                    "issued": issued,
                    "reference": reference,
                    "status": "credited",
                    "token_type": token_type,
                }
            )
        )
    random.SystemRandom().shuffle(bundle)
    return bundle


def unpack_token(token: str) -> dict[str, Any]:
    try:
        encoded, r_text, s_text = token.split(".")
        raw = decode_bytes(encoded)
        document = json.loads(raw)
        r, s = int(r_text, 16), int(s_text, 16)
    except (ValueError, UnicodeDecodeError, binascii.Error, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("malformed token") from exc

    if not isinstance(document, dict) or not verify(raw, r, s):
        raise ValueError("token seal is invalid")
    return document


def verify(raw: bytes, r: int, s: int) -> bool:
    if not (0 < r < ORDER and 0 < s < ORDER):
        return False
    inverse_s = inverse(s, ORDER)
    first = multiply(digest(raw) * inverse_s % ORDER)
    second = multiply(r * inverse_s % ORDER, PUBLIC_KEY)
    point = add(first, second)
    return point is not None and point[0] % ORDER == r


def public_record() -> dict[str, str]:
    x, y = PUBLIC_KEY
    return {
        "curve": "secp256k1",
        "format": "base64url(canonical-json).r-hex.s-hex",
        "hash": "SHA-256(token-shop/seal-v4\\x00 || canonical-json)",
        "ecdsa_encoding": "canonical low-S",
        "public_x": f"{x:064x}",
        "public_y": f"{y:064x}",
        "order": f"{ORDER:x}",
    }
