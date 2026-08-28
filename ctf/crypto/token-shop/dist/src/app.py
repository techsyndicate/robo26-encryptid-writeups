from __future__ import annotations

import os
import re
from pathlib import Path

from flask import Flask, jsonify, request

import ledger

ROOT = Path(__file__).resolve().parent
FLAG = os.environ.get("FLAG") or (ROOT / "flag.txt").read_text().strip()
USERNAME = re.compile(r"[A-Za-z0-9_-]{3,28}\Z")

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 2048


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(error="Request body is too large."), 413


@app.get("/")
def index():
    return (ROOT / "index.html").read_text()


@app.get("/api/public-key")
def public_key():
    return jsonify(ledger.public_record())


@app.post("/api/claim")
def claim():
    body = request.get_json(silent=True)
    username = body.get("username") if isinstance(body, dict) else None
    if not isinstance(username, str) or not USERNAME.fullmatch(username):
        return jsonify(error="Username must be 3–28 letters, numbers, _ or -."), 400
    if username.lower() in {"manager", "shopkeeper", "administrator"}:
        return jsonify(error="That username is reserved for Token Shop staff."), 403

    bundle = ledger.mint_token_bundle(username)
    return jsonify(
        message="Your customer token and four receipts have been issued.",
        bundle=bundle,
    )


def request_token() -> str | None:
    return request.headers.get("X-Shop-Token")


@app.get("/api/shop")
def shop():
    token = request_token()
    if not token:
        return jsonify(error="Present a token in X-Shop-Token."), 401
    try:
        claims = ledger.unpack_token(token)
    except ValueError as exc:
        return jsonify(error=str(exc)), 403

    required = {"username", "issued", "role", "reference", "series"}
    if (
        set(claims) != required
        or not isinstance(claims["username"], str)
        or not isinstance(claims["issued"], int)
        or not isinstance(claims["reference"], str)
        or claims["series"] != "token-shop-v4"
        or claims["role"] not in {"customer", "manager"}
    ):
        return jsonify(error="The token has an invalid document layout."), 403

    if claims["role"] != "manager":
        return jsonify(
            message="Customer token confirmed. The manager reward remains locked.",
            claims=claims,
        ), 200
    return jsonify(
        message="Manager token confirmed. The reward is unlocked.",
        flag=FLAG,
        claims=claims,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
