# Vault
## Challenge Info

**Category**: Reverse Engineering   
**Points:** 500   
**Challenge Description:**

```
The developer claims that the vault takes forever to load and is thus uncrackable. Prove them wrong.
```

## Recon

The binary is a 32-bit movfuscated ELF with no clear `main` in `objdump -d`. See `src/objdump.txt` for the full 25k instruction dump and `src/cfg.dot` for the control flow and `src/symbols.idc` for the demov symbols. Quick triage:

```bash
$ file src/vault
ELF 32-bit LSB executable, Intel i386, version 1 (SYSV), dynamically linked, interpreter /lib/ld-linux.so.2, stripped

$ strings src/vault | head -n 22
Access denied.
Format: XXXX-XXXX-XXXX-XXXX
Usage: %s <key>
encryptid vault terminal
Access granted! Flag: %s
TracerPid:
/proc/self/status
```

Running with a key prints `Access denied.` or `Access granted! Flag: %s` and expects `XXXX-XXXX-XXXX-XXXX` (four groups of hex). The `TracerPid:` string hints at anti-debug via `/proc/self/status`.

`objdump -d` shows almost all instructions are `mov` wired by a dispatch loop over a table:

```bash
$ grep "0x806e240" src/objdump.txt | head
mov 0x806e240(,%eax,4),%edx
```

This is classic movfuscator (movcc) where every operation is emulated through dispatch tables at `0x806e240` and `src/symbols.idc` maps `demov_*` helpers.

Dump the data section:

```bash
$ objdump -s -j .data src/vault
 806c030 04e58b17 a32141b5 743a1258 eddf0eb6  .....!A.t:.X....
 806c040 8b99ff7e 9c78ff37 46f0e4d7 a8a52781  ...~.x.7F.....'.
 806c050 7292716c 86416363 65737320 64656e69  r.ql.Access deni
 806c060 65642e0a 00466f72 6d61743a 20585858  ed...Format: XXX
 806c070 582d5858 58582d58 5858582d 58585858  X-XXXX-XXXX-XXXX
 806c080 0a005573 6167653a 20257320 3c6b6579  ..Usage: %s <key
 806c0b0 65737320 6772616e 74656421 20466c61  ess granted! Fla
 806c0c0 673a2025 730a0054 72616365 72506964  g: %s..TracerPid
 806c0d0 3a007200 2f70726f 632f7365 6c662f73  :.r./proc/self/s
 806c0e0 74617475 73000000 00000000 00000000  tatus...........
 806c0f0 00000000 00000000 00000000 00000000  ................
```

movcc stores globals in data cells at `0x806c0f0` to `0x806c0fc`. The constants are the only 32-bit immediates written there. `0x806c0f0` is the first 16 byte slot after `"/proc/self/status"` at `0x806c0e5`:

```bash
$ objdump -d src/vault | grep -E '\$0x[0-9a-f]{8},0x806c0f'
 804bb02: c7 05 f0 c0 06 08 ff  movl   $0xffffffff,0x806c0f0   # -1: init
 805b3c5: c7 05 f4 c0 06 08 b9  movl   $0x9e3779b9,0x806c0f4   # rng add (golden ratio)
 805b913: c7 05 fc c0 06 08 6b  movl   $0x85ebca6b,0x806c0fc   # rng mul #1
 805c3bb: c7 05 fc c0 06 08 35  movl   $0xc2b2ae35,0x806c0fc   # rng mul #2
 805e414: c7 05 f4 c0 06 08 6b  movl   $0x85ebca6b,0x806c0f4   # fround mul reuses same cell
 80607d9: c7 05 fc c0 06 08 1c  movl   $0x2f6e2b1c,0x806c0fc   # rng seed
 8062568: c7 05 f8 c0 06 08 1c  movl   $0x1c,0x806c0f8         # 28 = feistel rounds
 8062807: c7 05 f8 c0 06 08 33  movl   $0xf5aa3c33,0x806c0f8   # tag low
 8062aaf: c7 05 f8 c0 06 08 74  movl   $0xbdf5fe74,0x806c0f8   # tag high
 8064823: c7 05 f8 c0 06 08 7d  movl   $0x5a8c3f7d,0x806c0f8   # keystream xor
```

Only `movl $imm,0x806c0fX` with 8 hex digits are listed. Small writes like `movl $0x1,0x806c0f8` are runtime flags. Reads like `mov 0x806c0fc,%eax` are separate. Cells are reused: `0x806c0fc` holds seed and both muls, `0x806c0f4` holds golden ratio and fround mul, `0x806c0f0` holds -1. At `0x806c030` to `0x806c054` are 37 bytes of encrypted flag ending where `Access deni` starts at `0x806c055`.

Decoded decompiler is in `src/vault_patched.c` and `src/vault_patched` binary. Check `src/symbols.idc` for `R0..R3` at `0x806c0f0..0x806c0fc`.

## Exploitation

The check is a 64-bit Feistel over 28 rounds. The underlying PRNG is 32-bit: `state = (state + 0x9E3779B9) & 0xffffffff` then `z = state; z ^= z>>16; z = z * 0x85EBCA6B; z ^= z>>13; z = z * 0xC2B2AE35; z ^= z>>16` seeded with `0x2F6E2B1C` (stored to the same cell as the multipliers at `0x806c0fc`). The loop counter `0x1C` is 28 rounds and lives in the same cell as the tags and keystream xor at `0x806c0f8`. After 28 rounds the state is checked against `0xF5AA3C33` and `0xBDF5FE74`. The flag keystream is seeded with `0x5A8C3F7D` xored with the high half of the key, and the ciphertext is 37 bytes at `0x806c030` (`04e58b17a32141b5743a1258eddf0eb68b99ff7e9c78ff3746f0e4d7a8a527817292716c86`) up to `0x806c054`.

The 64-bit state is `low = k0<<16 | k1`, `high = k2<<16 | k3` where `k0..k3` are the four `XXXX` groups. Each round is:

```
forward: (low, high) -> (high, low ^ fround(high, c1, c2, rot))
fround: x ^= c1; rol(x, rot); x += c2; x *= 0x85EBCA6B; x ^= (x>>16) ^ c2
```

Each round draws three PRNG outputs in order: `c1` for xor, `c2` for add, `rot` for rotate. The PRNG is seeded `0x2F6E2B1C` so all 28 triples are deterministic. The binary has no real `rol`, `cmp`, `mul` opcodes - movcc emulates them via the `0x806e240` table - so the ops are recovered by tracing which cell each PRNG output flows into. The second `0x85EBCA6B` write at `0x805e414` confirms `fround` reuses the PRNG multiplier.

Comparisons are emulated: `XOR tag` and store zero flag, then branch on that flag for `Access granted` vs `Access denied`.

Invert the Feistel: forward is `low' = high`, `high' = low ^ f(high)`. So backward from tags `(low, high) = (0xF5AA3C33, 0xBDF5FE74)`:

```
high_prev = low
low_prev = high ^ fround(low, c1, c2, rot)
```

Replay PRNG to get each round's `c1,c2,rot`, apply inverse for rounds 28 down to 1, the starting `(low, high)` is the key.

Flag decrypt uses validated key's `high` half: `ks_state = 0x5A8C3F7D ^ high`, then each of 37 bytes is `plain = cipher ^ (rng(ks_state) & 0xFF)` advancing state each byte.

The solve script can be found [here](./solve.py).

## Flag

```
encryptid{y0u_sh0uld_h4ve_ju5t_4sk3d}
```

*Writeup written by Aarav Juneja*
