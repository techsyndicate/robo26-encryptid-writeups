#!/usr/bin/env python3
M32 = (1 << 32) - 1

def rol(v, n):
    return ((v << n) | (v >> (32 - n))) & M32

def rng(state):
    state = (state + 0x9E3779B9) & M32
    z = state
    z ^= z >> 16
    z = z * 0x85EBCA6B & M32
    z ^= z >> 13
    z = z * 0xC2B2AE35 & M32
    z ^= z >> 16
    return z & M32, state

def fround(x, c1, c2, rot):
    x ^= c1
    x = rol(x, rot & 31)
    x = (x + c2) & M32
    x = x * 0x85EBCA6B & M32
    x ^= (x >> 16) ^ c2
    return x & M32

def params(seed):
    state = seed
    out = []
    for _ in range(28):
        c1, state = rng(state)
        c2, state = rng(state)
        rot, state = rng(state)
        out.append((c1, c2, rot))
    return out

seed = 0x2F6E2B1C
low, high = 0xF5AA3C33, 0xBDF5FE74
for c1, c2, rot in reversed(params(seed)):
    high_prev = low
    low_prev = (high ^ fround(low, c1, c2, rot)) & M32
    low, high = low_prev, high_prev

keys = [(low >> 16) & 0xFFFF, low & 0xFFFF, (high >> 16) & 0xFFFF, high & 0xFFFF]
print("-".join(f"{k:04X}" for k in keys))

stored = bytes.fromhex("04e58b17a32141b5743a1258eddf0eb68b99ff7e9c78ff3746f0e4d7a8a527817292716c86")
state = 0x5A8C3F7D ^ ((keys[2] << 16) | keys[3])
flag = bytearray()

for b in stored:
    ks, state = rng(state)
    flag.append(b ^ (ks & 0xFF))

print(flag.decode())
