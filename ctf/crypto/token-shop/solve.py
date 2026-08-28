#!/usr/bin/env python3
import hashlib, json, base64, itertools, secrets, time
import requests, sys

ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
FIELD = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
GENERATOR = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)
SEAL_DOMAIN = b"token-shop/seal-v4\x00"
CURVATURE = int.from_bytes(hashlib.sha256(b"token-shop/qcg/quadratic").digest(), "big") % ORDER
DRIFT = int.from_bytes(hashlib.sha256(b"token-shop/qcg/linear").digest(), "big") % ORDER

def inverse(v,m): return pow(v % m, -1, m)
def add(l,r):
    if l is None: return r
    if r is None: return l
    x1,y1=l; x2,y2=r
    if x1==x2 and (y1+y2)%FIELD==0: return None
    if l==r:
        slope=3*x1*x1*inverse(2*y1,FIELD)%FIELD
    else:
        slope=(y2-y1)*inverse(x2-x1,FIELD)%FIELD
    x3=(slope*slope - x1 - x2)%FIELD
    return x3, (slope*(x1 - x3)-y1)%FIELD
def multiply(scalar, point=GENERATOR):
    res=None; cur=point
    while scalar:
        if scalar &1: res=add(res,cur)
        cur=add(cur,cur)
        scalar>>=1
    return res
def canonical_bytes(doc): return json.dumps(doc, sort_keys=True, separators=(",",":")).encode()
def encode_bytes(raw): return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
def decode_bytes(text): return base64.urlsafe_b64decode(text + "="*(-len(text)%4))
def digest(raw): return int.from_bytes(hashlib.sha256(SEAL_DOMAIN+raw).digest(),"big")

def tonelli_sqrt(a,p):
    if a==0: return 0
    if pow(a,(p-1)//2,p)!=1: return None
    q=p-1; s=0
    while q%2==0: q//=2; s+=1
    z=2
    while pow(z,(p-1)//2,p)!=p-1: z+=1
    m=s; c=pow(z,q,p); t=pow(a,q,p); R=pow(a,(q+1)//2,p)
    while True:
        if t==1: return R
        i=1; tmp=pow(t,2,p)
        while i<m:
            if tmp==1: break
            tmp=pow(tmp,2,p); i+=1
        b=pow(c,1 << (m-i-1), p)
        m=i; c=pow(b,2,p); t=t*c%p; R=R*b%p

def solve_quadratic(p2,p1,p0):
    p2%=ORDER; p1%=ORDER; p0%=ORDER
    if p2==0:
        if p1==0: return [] if p0!=0 else None
        return [(-p0)*pow(p1,-1,ORDER)%ORDER]
    D=(p1*p1-4*p2*p0)%ORDER
    s=tonelli_sqrt(D,ORDER)
    if s is None: return []
    inv=pow(2*p2,-1,ORDER)
    r1=(-p1+s)*inv%ORDER; r2=(-p1-s)*inv%ORDER
    return [r1] if r1==r2 else [r1,r2]

def parse_token(tok):
    enc,rhex,shex=tok.split(".")
    raw=decode_bytes(enc)
    doc=json.loads(raw)
    H=digest(raw)
    r=int(rhex,16); s=int(shex,16)
    return {"enc":enc,"raw":raw,"doc":doc,"H":H,"r":r,"s":s,
            "A_raw":H*pow(s,-1,ORDER)%ORDER,
            "B_raw":r*pow(s,-1,ORDER)%ORDER,
            "token":tok}

def recover_private(bundle, pubkey):
    parsed=[parse_token(t) for t in bundle]
    customers=[p for p in parsed if "role" in p["doc"]]
    receipts=[p for p in parsed if "token_type" in p["doc"]]
    assert len(customers)==1 and len(receipts)==4
    cust=customers[0]
    for perm in itertools.permutations(receipts):
        ordered=[cust]+list(perm)
        A_raws=[p["A_raw"] for p in ordered]
        B_raws=[p["B_raw"] for p in ordered]
        rs=[p["r"] for p in ordered]
        for mask in range(32):
            es=[1 if ((mask>>i)&1)==0 else -1 for i in range(5)]
            A=[(es[i]*A_raws[i])%ORDER for i in range(5)]
            B=[(es[i]*B_raws[i])%ORDER for i in range(5)]
            def coeff(i):
                Ai,Bi=A[i],B[i]; Aj,Bj=A[i+1],B[i+1]; Ak,Bk=A[i+2],B[i+2]
                p2=(CURVATURE*(-Bi*Bi + Bj*Bj))%ORDER
                p1=(Bj -2*CURVATURE*Ai*Bi - DRIFT*Bi - Bk +2*CURVATURE*Aj*Bj + DRIFT*Bj)%ORDER
                p0=(Aj - CURVATURE*Ai*Ai - DRIFT*Ai - Ak + CURVATURE*Aj*Aj + DRIFT*Aj)%ORDER
                return p2,p1,p0
            p2_0,p1_0,p0_0=coeff(0)
            p2_1,p1_1,p0_1=coeff(1)
            p2_2,p1_2,p0_2=coeff(2)
            sol=solve_quadratic(p2_0,p1_0,p0_0)
            if sol is None:
                sol=solve_quadratic(p2_1,p1_1,p0_1)
                if not sol: continue
                for d in sol:
                    if (p2_0*d*d+p1_0*d+p0_0)%ORDER!=0: continue
                    if (p2_2*d*d+p1_2*d+p0_2)%ORDER!=0: continue
                    if multiply(d)!=pubkey: continue
                    if all(multiply((A[i]+B[i]*d)%ORDER)[0]%ORDER==rs[i] for i in range(5)):
                        return d, ordered, es
                continue
            if not sol: continue
            for d in sol:
                if (p2_1*d*d+p1_1*d+p0_1)%ORDER!=0: continue
                if (p2_2*d*d+p1_2*d+p0_2)%ORDER!=0: continue
                if multiply(d)!=pubkey: continue
                if all(multiply((A[i]+B[i]*d)%ORDER)[0]%ORDER==rs[i] for i in range(5)):
                    return d, ordered, es
    return None

def forge_manager(priv):
    doc={"username":"poki","issued":int(time.time()),"role":"manager","reference":secrets.token_hex(8),"series":"token-shop-v4"}
    raw=canonical_bytes(doc)
    while True:
        k=secrets.randbelow(ORDER-1)+1
        pt=multiply(k)
        if pt is None: continue
        r=pt[0]%ORDER
        if r==0: continue
        s=inverse(k,ORDER)*(digest(raw)+r*priv)%ORDER
        if s==0: continue
        if s>ORDER//2: s=ORDER-s
        tok=f"{encode_bytes(raw)}.{r:064x}.{s:064x}"
        return tok, doc

def main():
    print("[*] fetching public key")
    r=requests.get("https://token-shop-encryptid.onrender.com/api/public-key")
    r.raise_for_status()
    j=r.json()
    pub=(int(j["public_x"],16), int(j["public_y"],16))
    print(f"    pub = {j['public_x'][:16]}...")

    print("[*] claiming bundle")
    uname="poki"
    r=requests.post("https://token-shop-encryptid.onrender.com/api/claim", json={"username":uname})
    r.raise_for_status()
    bundle=r.json()["bundle"]
    print(f"    got {len(bundle)} tokens for {uname}")

    print("[*] recovering private key (24 perms * 32 signs)")
    rec=recover_private(bundle, pub)
    if not rec:
        print("[!] failed with one bundle, trying second claim")
        r=requests.post("https://token-shop-encryptid.onrender.com/api/claim", json={"username":uname})
        r.raise_for_status()
        bundle2=r.json()["bundle"]
        rec=recover_private(bundle2, pub)
        if not rec:
            print("[-] recovery failed"); sys.exit(1)
    d, ordered, es = rec
    print(f"[+] private key = {hex(d)}")
    print(f"    perm {[p['doc'].get('token_type','customer') for p in ordered[1:]]} mask {''.join(str(1 if e==-1 else 0) for e in es)}")

    tok, doc = forge_manager(d)
    r=requests.get("https://token-shop-encryptid.onrender.com/api/shop", headers={"X-Shop-Token":tok})
    print(r.json()["flag"])

if __name__=="__main__":
    main()