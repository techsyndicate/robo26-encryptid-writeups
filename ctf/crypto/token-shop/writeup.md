# Token Shop

## Challenge Info

**Category:** Cryptography   
**Points:** 250   
**Challenge Description:**

```
I like tokenz https://token-shop-encryptid.onrender.com/
```

## Recon

The following endpoints are public to us: one to fetch the public key of the shop, one to claim a bundle of tokens and one to access the shop itself by providing a token.

Looking at the token claiming logic, we see that when a user requests a claim the server generates five tokens:

1. Customer Token to identify the user
2. 4 Reciept Tokens for different tiers (bronze, silver, gold and platinum).

These five tokens are signed using ECDSA on the `secp256k1` curve. The order in which the receipt tokens are generated is randomized before signing and the entire bundle is randomized again before being sent back to the user.

To access the shop and retrieve the flag, we need to provide a token that has the `role` field set to `manager`. The server verifies the token's ECDSA signature using its private key and ensures the structure is correct. Our goal thus is to recover the server's private key to forge our own manager token.

The vulnerability lies in how the server generates the cryptographic nonces (k) for the ECDSA signatures. Instead of using a secure random number generator for every signature it uses the `TicketSequence` class which implements a Quadratic Congruential Generator (QCG):

```python
CURVATURE = int.from_bytes(hashlib.sha256(b"token-shop/qcg/quadratic").digest(),"big") % ORDER
DRIFT     = int.from_bytes(hashlib.sha256(b"token-shop/qcg/linear").digest(),"big") % ORDER

class TicketSequence:
    def __init__(self):
        self.increment = secrets.randbelow(ORDER-1)+1
        self.state     = secrets.randbelow(ORDER-1)+1
    def next_scalar(self):
        self.state = (CURVATURE*self.state*self.state + DRIFT*self.state + self.increment) % ORDER
        if self.state==0: self.state=self.increment
        return self.state
```

The relation between consecutive nonces is `k{i+1} = C * k{i^2} + D * k{i} + inc (mod ORDER)` where `C` (curvature) and `D` (drift) are known public constants, and `inc` and the initial state are secret.

When a user requests a bundle the application is single threaded i.e. the five tokens are signed with five strictly consecutive nonces from this QCG sequence.

## Exploitation

For a message with hash `H = digest(raw)` (known, we decode `raw`):

```
s = k^{-1}(H + r*d)  mod ORDER
r = (k*G){x} mod ORDER
```

If `k` were known, `d = r^{-1}(s*k - H)`. With two signatures sharing same `k`, `d` is trivial. Here `k` are distinct but algebraically related via QCG giving enough equations to solve for `d`.

Low S makes observed `s{obs} = min(s, ORDER-s)`. So `s{true} = ± s{obs} mod ORDER` and

```
k = e * inv(s{obs})*(H + r*d)  , e = ±1 per signature
```

Define for each observed token:

```
A{raw} = H*inv(s{obs}) %ORDER
B{raw} = r*inv(s{obs}) %ORDER
A = e*A{raw}
B = e*B{raw}
k(d) = A + B*d  mod ORDER               (1)
```

QCG: `k{i+1}= C*k{i^2} + D*k{i} + inc`

`inc = k{i+1} - C*k{i^2} - D*k{i}` is constant for all `i`. Equate consecutive `i`:

```
k{i+1} - C*k{i^2} - D*k{i}  =  k{i+2} - C*k{i+1^2} - D*k{i+1}   (2)
```

Plug (1) into (2). Let `i=0` uses `(k{0},k{1},k{2})`, `i=1` uses `(k{1},k{2},k{3})`, `i=2` uses `(k{2},k{3},k{4})` giving us 3 equations, 1 unknown `d` (for fixed permutation and sign mask).

Expand: write `k{i} = A{i} + B{i} d`

```
k{i+1}: A{i+1}+B{i+1}d
k{i^2}: A{i^2} +2A{i}B{i} d + B{i^2} d^{2}
...
=>  C*(-B{i^2} + B{i+1^2}) d^{2}
  + (B{i+1} -2C A{i}B{i} -D B{i} -B{i+2} +2C A{i+1}B{i+1} +D B{i+1}) d
  + (A{i+1} -C A{i^2} -D A{i} -A{i+2} +C A{i+1^2} +D A{i+1}) =0
```

So `p2*d^{2} + p1*d + p0 =0` mod `ORDER` quadratic in `d`.

With one bundle we have `f{0}(d)=0` (using k{0},k{1},k{2}), `f{1}(d)=0` (k{1},k{2},k{3}), `f{2}(d)=0` (k{2},k{3},k{4}). Solving `f{0}` gives ≤ 2 candidates; filtering by `f{1},f{2}`, by `d*G == PUBLIC_KEY` and by checking `r{i} == (k{i}(d)*G){x}` eliminates false positives from wrong permutation/sign.

`ORDER` is prime but `ORDER %4 ==1` (`0x...4141 %4 ==1`) so square roots need Tonelli Shanks not `pow((p+1)//4)`. Implementation in `solve.py` handles `p%4==1`.

Need at most one claim (5 signatures) -> 24 perms x 32 sign masks = 768 combos x solving one quadratic

```bash
$ curl -s https://token-shop-encryptid.onrender.com/api/public-key
{"curve":"secp256k1","public{x}":"3f2a98a93fb7fc2163825d1bcb56e8489828acf313cb1057d381f7323d99b007",
 "public_y":"21de9559362ecd739f78df308b85e7806a31778573d37c7fcb337ecbcc5407e3", ...}

$ curl -s -X POST -H "Content-Type: application/json" -d '{"username":"poki"}' \
  https://token-shop-encryptid.onrender.com/api/claim
{"bundle":["eyJ...silver...38e7135d...","eyJ...bronze...4286a862...","eyJ...platinum...6a18f3...","eyJ...customer...51f13729...","eyJ...gold...6993455..."],...}
```

Decode customer token:

```json
{"issued":1787867977,"reference":"50cbf6c66386c100","role":"customer","series":"token-shop-v4","username":"poki"}
```

Running `solve.py` on this bunch:

```
[*] fetching public key
    pub = 3f2a98a93fb7fc21...
[*] claiming bundle
    got 5 tokens for poki
[*] recovering private key (24 perms * 32 signs)
[+] private key = 0xd4c0b2d7a3190dfe5cc8e572aa906e97af8a3ce71336f52a42bc026c0ce72568
    perm ['silver','bronze','gold','platinum'] mask 10010
```

Second fresh claim gives same private key with different perm `['platinum','bronze','silver','gold'] mask 01111`.

With `d` we can sign any document with fresh random `k` (no need to follow QCG as verification only checks ECDSA). Implement `seal_forge` like :

```python
def seal_forge(doc, priv=d):
    raw = canonical_bytes(doc)
    k = secrets.randbelow(ORDER-1)+1
    r = multiply(k)[0] % ORDER
    s = pow(k,-1,ORDER)*(digest(raw)+r*priv) % ORDER
    if s > ORDER//2: s = ORDER-s
    return f"{encode_bytes(raw)}.{r:064x}.{s:064x}"

doc = {"username":"poki","issued":int(time.time()),
       "role":"manager","reference":token_hex(8),"series":"token-shop-v4"}
tok = seal_forge(doc)
```

Submit to shop:

```bash
$ curl -s https://token-shop-encryptid.onrender.com/api/shop -H "X-Shop-Token: $tok"
{"claims":{"issued":1787867997,"reference":"7de3c4f210f9e777","role":"manager","series":"token-shop-v4","username":"poki"},
 "flag":"encryptid{w04h_h3ll0_f3ll0w_en7hus14st!}","message":"Manager token confirmed. The reward is unlocked."}
```

The solve script is [here](./solve.py).

## Flag

```
encryptid{w04h_h3ll0_f3ll0w_en7hus14st!}
```

*Writeup written by Aarav Juneja*
