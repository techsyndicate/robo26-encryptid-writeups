#!/usr/bin/env python3
import hashlib

try:
    from Crypto.Cipher import AES
except ImportError:
    AES = None

SALT2 = b"phase-loom/weave-of-one-way-gates"
KEY = bytes.fromhex("0bddb8d1f16f91a592e4693d69b7b114")
P = 126835284229173436
Q = 10059119762309031284
NONCE = bytes.fromhex("38f3f57f70c32bf9fcb95bf15cbb3daa")
CT = bytes.fromhex("29d9a6ae1e6ec6b7e3034657bae221d718a87ab5d62c9a47f510a9ea193babef7ab32094f0c63b85c8b5e894f048025f520e")

def decrypt_flag():
    kdf = hashlib.sha256(SALT2 + KEY + P.to_bytes(8, 'little') + Q.to_bytes(8, 'little')).digest()
    if AES is None:
        print("need pycryptodome: pip install pycryptodome")
        print(f"kdf sha256={kdf.hex()}")
        print(f"nonce={NONCE.hex()}")
        return
    nonce_part = NONCE[:8]
    init_val = int.from_bytes(NONCE[8:], 'big')
    aes = AES.new(kdf, AES.MODE_CTR, nonce=nonce_part, initial_value=init_val)
    flag = aes.decrypt(CT)
    print(flag.decode())

if __name__ == "__main__":
    decrypt_flag()
