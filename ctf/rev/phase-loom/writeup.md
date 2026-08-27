# Phase Loom

## Challenge Info

**Points:** 500  
**Difficulty:** Hard  
**Challenge Description:**

```
pygaming

The random looking values in the binary are not independent secrets. They were generated sequentially by one reused Python random.Random instance. The two lattice values occur earlier in that stream than the constants used by the verifier. Recover the PRNG stream/state instead of attempting a direct 2^128 hash search.
```

Provided files: `src/phase-loom` (Rust PIE, embeds Python 3.14), `src/phase-loom.c` (decompiler output), `src/objdump.txt` (loader disasm), `extracted/` bundle decoded from the loader (`game.py`, `libphase_loom_core.so`, `libphase_loom_core.so.c`, `libphase_loom_core-objdump.txt`, `payload.bin`, `phase_rt_engine_000000/phase_rt_engine.so`, `fonts/`). All offsets below are file offsets == virtual addresses in `.rodata` (`vaddr == offset`), while `.text` is `vaddr == offset + 0x1000`. The embedded `.so` keeps `vaddr == offset + 0x1000` for `.text`.

## Recon

Start with the loader:

```bash
$ file src/phase-loom
ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, stripped

$ readelf -h src/phase-loom
  Type: DYN (Position-Independent Executable file)
  Machine: Advanced Micro Devices X86-64
  Entry point address: 0xa4550
  Number of section headers: 31

$ readelf -SW src/phase-loom
  [11] .rodata           PROGBITS        0000000000006940 006940 095d60 00 AMS  0   0 16
  [14] .text             PROGBITS        00000000000a4550 0a3550 04f5aa 00  AX  0   0 16
  [22] .data.rel.ro      PROGBITS        00000000000f4b98 0f2b98 0021a0 00  WA  0   0  8
  [28] .data             PROGBITS        00000000000f8380 0f5380 000aa8 00  WA  0   0  8
```

The `nb3tkx7e` export (Rust `no_mangle`) plus `_z9kq` and `_phase_payload` (Python names injected at runtime, see `run_game` in `src/phase-loom.c`) show a Rust binary embedding Python via pyo3 (CPython 3.14.6) running an obfuscated pygame game. No direct `pyarmor` string remains due to debranding, but the behavior reveals it.

Trace unpacking before cleanup wipes the temp dir:

```bash
$ strace -f -e trace=file,unlink,unlinkat src/phase-loom
2469  mkdir("/tmp/.m<hex>", 0777)                         = 0
2469  openat(AT_FDCWD, "/tmp/.m<hex>/game.py", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3
2469  mkdir("/tmp/.m<hex>/phase_rt_engine_000000", 0777)  = 0
2469  openat(AT_FDCWD, "/tmp/.m<hex>/phase_rt_engine_000000/phase_rt_engine.so", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3
2469  chmod("/tmp/.m<hex>/phase_rt_engine_000000/phase_rt_engine.so", 0755) = 0
2469  openat(AT_FDCWD, "/tmp/.m<hex>/libphase_loom_core.so", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3
2469  chmod("/tmp/.m<hex>/libphase_loom_core.so", 0755)   = 0
2469  mkdir("/tmp/.m<hex>/fonts", 0777)                   = 0
2469  openat(AT_FDCWD, "/tmp/.m<hex>/fonts/PressStart2P-Regular.ttf", ...) = 3
2469  unlinkat(5, "Lato-Bold.ttf", 0)                        = 0
2469  unlinkat(4, "libphase_loom_core.so", 0)                = 0
2469  unlinkat(4, "game.py", 0)                              = 0
2469  unlinkat(AT_FDCWD, "/tmp/.m<hex>", AT_REMOVEDIR)    = 0

$ ltrace -e dlopen+dlsym+dlclose src/phase-loom
libpython3.14.so.1.0->dlopen("/tmp/.m<hex>/phase_rt_engine_000000/phase_rt_engine.so", 2) = 0x5dd5336f4210
libpython3.14.so.1.0->dlsym(0x5dd5336f4210, "PyInit_phase_rt_engine") = 0x74a091010bf0
```

The bundle materializes at `/tmp/.m{pid ^ 0x5a17c3e9}` then is unlinked in reverse. `dlsym` resolves `PyInit_phase_rt_engine` to `base + 0x10bf0`, matching `readelf` export. The Rust-side `dlopen` of `libphase_loom_core.so` is via function pointer and invisible to `ltrace`. A `LD_PRELOAD` shim that ignores `unlinkat` or `gdb catch syscall unlinkat` captures the files without decoding. The decoded bundle is already in `extracted/` for this writeup.

Loader logic in `src/objdump.txt` is at `0xa7497..0xa94xx`:

```c
main():
  dir  = /tmp/.m{pid ^ 0x5a17c3e9}
  materialize(dir):            # 0xa7497 loop over TABLE (416 bytes = 8 x 52)
  preflight_core(dir/core.so)  # 0xa94b7: dlopen + dlsym("nb3tkx7e") + call; must return 0
  Python::initialize()
  run_game():                  # 0xa488c
      sys._z9kq = dir
      sys.argv = args
      sys.path.insert(0, dir)
      globals = {__name__:"__main__", __file__:game.py, _phase_payload: payload}
      exec(open(dir/game.py).read(), globals)
```

## Exploitation

### 1. Unpacking the Rust loader

The launcher embeds `SEED` (16 B), `ALPHABET` (30 B XOR masked with SEED), `NAMES` (185 B alphabet indexes), `DATA` (583430 B XOR+zlib blobs) and `TABLE` (8 entries). Each entry is 52 bytes: `digest[32]` then `name_offset, name_length, data_offset, compressed_len, decompressed_len` at `+0x20..+0x30`.

| address | blob |
| --- | --- |
| `0x6a20` | `SEED[16]` = `e5 ea a6 2e c6 f4 50 69 15 12 ad 32 44 f5 0c a8` |
| `0x87c0` | `DATA` (583430 B) ends `0x96ec6` |
| `0x96ec6` | `NAMES` (185 B) |
| `0x98d72` | `ALPHABET` (30 B, `ALPHABET[i] = charset[i] ^ SEED[i%16]`) |
| `0x98e40` | `TABLE` 8 x 52 B |

Decoded table:

| # | name | data_offset | compressed_len | decompressed_len |
| - | --- | --- | --- | --- |
| 0 | `game.py` | 0 | 95 | 117 |
| 1 | `phase_rt_engine_000000/__init__.py` | 95 | 45 | 41 |
| 2 | `phase_rt_engine_000000/phase_rt_engine.so` | 140 | 258220 | 804808 |
| 3 | `libphase_loom_core.so` | 258360 | 159346 | 311112 |
| 4 | `fonts/PressStart2P-Regular.ttf` | 417706 | 38738 | 115280 |
| 5 | `fonts/Lato-Regular.ttf` | 456444 | 35445 | 72312 |
| 6 | `fonts/Lato-Bold.ttf` | 491889 | 34729 | 70576 |
| 7 | `payload.bin` | 526618 | 56812 | 56786 |

How decode works (`src/objdump.txt`):

```asm
a7497:  lea 0x98e40(%rip),%r13        ; TABLE base
a7542:  cmp $0x1a0,%r14 / je a9330    ; loop 0x1a0 = 416 = 8 x 52 bytes
a754f:  mov 0x28(%r13),%r15d          ; data_offset     (+0x28)
a7553:  mov 0x2c(%r13),%ebx           ; compressed_len  (+0x2c)
a7562:  lea 0x87c0(%rip),%rcx         ; DATA base
a7582:  movups 0x6a20(%rip),%xmm0     ; SEED -> 16 byte stack buffer
a7599:  mov %dl,0x2ab0(%rsp)          ; blob index byte appended -> sha256(SEED||index)
a75c9:  movb $0x80,0x2ab1(%rsp)       ; SHA256 padding marker
a7f5e:  mov 0x20(%r12),%r15d          ; name_offset     (+0x20)
a7f63:  mov 0x24(%r12),%ebx           ; name_length     (+0x24)
a7f72:  lea 0x96ec6(%rip),%rdx        ; NAMES base
a800b:  movzbl (%r12),%edi            ; alphabet index
a8010:  cmp $0x1e,%rdi / jae a9286    ; index < 30
a801c:  and $0xf,%ecx                 ; index % 16
a801f:  lea 0x6a20(%rip),%rdx         ; SEED
a802c:  lea 0x98d72(%rip),%rcx        ; ALPHABET (masked)
a8033:  xor (%rdi,%rcx,1),%bpl        ; char = ALPHABET[index] ^ SEED[index%16]
```

Per blob: `key = sha256(SEED || index)`, `blob = DATA[data_offset .. +compressed_len] XOR key (repeating 32)`, `plain = zlib-inflate(blob)`, verify `sha256(plain) == digest` and `len == decompressed_len`, else `phase-loom: fatal error N` at `0x98cca` (miniz_oxide).

Unpack without running:

```python
seed  = data[0x6a20:0x6a30]
table_base = 0x98e40
data_base  = 0x87c0
alphabet   = bytes(data[0x98d72 + i] ^ seed[i % 16] for i in range(30))
names      = bytes(alphabet[b] for b in data[0x96ec6:0x96ec6 + 185])
for i in range(8):
    name_offset, name_length, data_offset, compressed_len, decompressed_len = struct.unpack_from("<IIIII", data, table_base + i*52 + 32)
    key  = hashlib.sha256(seed + bytes([i])).digest()
    blob = bytes(b ^ key[k % 32] for k, b in enumerate(data[data_base+data_offset:data_base+data_offset+compressed_len]))
    plain = zlib.decompress(blob)
    path = names[name_offset:name_offset+name_length].decode()
    open(path, 'wb').write(plain)
```

This reproduces `extracted/` exactly. See `src/phase-loom.c` for the decompiled `materialize` loop.

### 2. PyArmor debrand

`game.py` is 117 bytes:

```python
#!/usr/bin/env python3
from phase_rt_engine_000000 import _phase_boot
_phase_boot(__name__, __file__, _phase_payload)
```

This is a PyArmor 9.2.6 stub debranded (`pyarmor_runtime_000000` -> `phase_rt_engine_000000`, `__pyarmor__` -> `_phase_boot`, `pyarmor_runtime.so` -> `phase_rt_engine.so`). Clues:

* `payload.bin` starts with `PY000000` magic (header `PY000000 \x00\x03\x0e\x00 ...`, version 3).
* `phase_rt_engine.so` (804808 B) exports `PyInit_phase_rt_engine@@PHASE_LOOM_RUNT_1 @ 0x10bf0` (original `PYARMOR_RUNTIME_1`).
* Marker `pyarmor-vax-000000` at `0xbea0c` in `phase_rt_engine.so` (VM advanced variant). Stock runtime markers like `PYARMOR.CORE` were removed.
* `__init__.py` (41 B) is `from .phase_rt_engine import _phase_boot`.

The game is a thin pygame UI. All crypto is in `libphase_loom_core.so`. Oracles:

| UI | calls | meaning |
| --- | --- | --- |
| `ECHO A/B` | `dt8vjl5c(p,q)` | leaks `checkpoints[2]` and `checkpoints[6]` (u32 LE) |
| `RESONANCE d/8` | `q7wmcx3b(p,q)` | depth 0..8 |
| `TRY` | `sz2knf4a(p,q,buf,len)` | verify + decrypt, returns 0 on success |
| `nb3tkx7e()` | self check | must return 0 |
| `hr4pzq6d()` | flag len | returns 50 |

### 3. Core `.so` leaks

```bash
$ readelf -sW extracted/libphase_loom_core.so | grep -E "sz2knf4a|q7wmcx3b|dt8vjl5c|hr4pzq6d|nb3tkx7e"
dt8vjl5c  @ 0x109f0  (93 B)   echo_a/echo_b
hr4pzq6d  @ 0x10a50  (6 B)    -> 50
nb3tkx7e  @ 0x10a60  (259 B)  preflight
q7wmcx3b  @ 0x10b70  (260 B)  depth
sz2knf4a  @ 0x10c80  (4008 B) verify + AES-CTR decrypt
```

Map obfuscated names for readability:

```c
#   sz2knf4a -> pl_commit
#   q7wmcx3b -> pl_depth
#   dt8vjl5c -> pl_marks
#   hr4pzq6d -> pl_flag_len
#   nb3tkx7e -> pl_self_check
```

Semantics: `pl_self_check` checks `sha256(key)[0..8] == K_DIGEST`, flag non-empty, `sz2knf4a(0,0)` fails, `dt8vjl5c(0,0)` non-zero. `pl_depth(p,q)` runs `chain(p,q)` vs `STAGE_CKPT`. `pl_commit(p,q,out,len)` returns 1 if `p > FREE_P` or `q > FREE_Q`, else decrypts with `AES-256-CTR(encrypted_flag)` key `SHA256(SALT2||key||p_le||q_le)` nonce `NONCE` when depth==8, else 1/2/3 by depth.

Chain: `state = SHA256(SALT2 || key || p_le || q_le)`. For stage `s` save `checkpoints[s] = state[0..8]`. While `s < 7` `state = SHA256(pad(state) || TAG[s].le)`. `pad` does `rotl(w, ROT[8s+j]) + ADD[8s+j] ^ key_word[(s+j)%4]`, `SBOX` substitute, `* MUL[s]`.

**Leak 1 - KEY (16 B) via K_DIGEST:** In `libphase_loom_core.so.c` `nb3tkx7e @ 0x10A60`:

```c
sub_10320(v8, (const __m128i *)&v5, 0x10u);
if ( v8[0].m128i_i64[0] == 0xF23675E79300D60FLL )  // K_DIGEST LE
```

So `K_DIGEST = 0fd60093e77536f2`. KEY is not stored as `K`, but as `MASK_A ^ MASK_B ^ MASK_C` folded to `xmmword_2A60 @ 0x2a60 = 0x14B1B7693D69E492A5916FF1D1B8DD0B` (LE bytes `0b dd b8 d1 f1 6f 91 a5 92 e4 69 3d 69 b7 b1 14` => `0bddb8d1f16f91a592e4693d69b7b114`). Brute force: scan 16-byte windows for `sha256(window)[:8] == K_DIGEST`.

```python
for i in range(len(core)-16):
    if hashlib.sha256(core[i:i+16]).digest()[:8] == k_digest:
        key = core[i:i+16]   # 0bddb8d1f16f91a592e4693d69b7b114 @ 0x2a60
```

**Leak 2 - NONCE (16 B) in `sz2knf4a @ 0x10C80`:**

```c
v141[1] = 0xAA3DBB5CF15BB9FCLL;
v141[0] = 0xF92BC3707FF5F338LL;
sub_E8F0(dest, ptr, (unsigned __int8 *)v141);   // AES-CTR
```

LE layout `38 f3 f5 7f 70 c3 2b f9 | fc b9 5b f1 5c bb 3d aa` => `38f3f57f70c32bf9fcb95bf15cbb3daa`. Two 64-bit `movabs` immediates, not a 16-byte rodata find. Next blocks increment counter to `0xAB3DBB5CF15BB9FC` etc. AES-NI path has reversed copy.

**Leak 3 - ROT/ADD/MUL/TAG/SBOX block anchored at `TAG[0] = 0xA51DF4F26E85E730` (`30 e7 6e 85 f2 f4 1d a5` LE):**

| vaddr | array | bytes |
| --- | --- | --- |
| `0x5388` | `TAG[8]` u64 | 64 |
| `0x53c8` | `ROT[64]` u32 | 256 |
| `0x54c8` | `ADD[64]` u32 | 256 |
| `0x55c8` | `H[8]` u32 SHA-NI IV | 32 |
| `0x55e8` | `MUL[8]` u32 | 32 |
| `0x5628` | `SBOX[256]` u8 | 256 |
| `0x5728` | `ENCRYPTED_FLAG[50]` | 50 |

Symbols `unk_5388`, `byte_53C8`, `dword_54C8`, `unk_55E8`, `byte_5628`, `xmmword_5728`. `sub_FAC0` reads them via `__ROL4__(v25, byte_53C8[...])` etc. Extraction: find `TAG[0]`, then `ROT = +64`, `ADD = +320`, `MUL = +576+32`. Checks: every `ROT[i] <= 31`, every `MUL[i]` odd (`getrandbits(32)|1`), `SBOX` is permutation.

**Leak 4 - ENCRYPTED_FLAG (50 B) at `0x5728` via `hr4pzq6d() -> 50`:**

```c
v11 = malloc(0x32u);
v11[2] = xmmword_5748;   // bytes 32..47
v11[1] = xmmword_5738;   // 16..31
*v11   = xmmword_5728;   // 0..15 -> 0x5728
*((_WORD *)v11 + 24) = 3666;   // 0x0E52 last 2 bytes
```

`xmmword_5728 = 0xD721E2BA574603E3B7C66E1EAEA6D929` LE `29 d9 a6 ae 1e 6e c6 b7 e3 03 46 57 ba e2 21 d7` => full hex `29d9a6ae1e6ec6b7e3034657bae221d718a87ab5d62c9a47f510a9ea193babef7ab32094f0c63b85c8b5e894f048025f520e`.

**Leak 5 - SALT2 (33 B) `phase-loom/weave-of-one-way-gates` via `salt2()` OnceLock:**

```c
// SALT2_MASK @ 0x2950, SALT2_XOR @ 0x5362
_BYTE byte_2950[16] = { -44, -18, -27, 122, -108, 26, 33, -52, -100, 70, 110, -117, 28, 10, -72, 58 };
_BYTE byte_5362[38]  = { -92, -122, -124, 9, -15, 55, 77, -93, -13, 43, 65, -4, 121, 107, -50, ... };
v13 = byte_5362[i] ^ byte_2950[i & 0xF];
```

`SALT2_MASK = d4 ee e5 7a 94 1a 21 cc 9c 46 6e 8b 1c 0a b8 3a`, `SALT2_XOR = a4 86 84 09 f1 37 4d a3 f3 2b 41 fc 79 6b ce 5f ...`.

**Leak 6 - STAGE_CKPT (8 u64) ladder in `q7wmcx3b @ 0x10B70`:**

```c
if ( v10[0] == 0x6F14B7E4DC8DFCE6LL ) { result = 1;
  if ( v10[1] == 0x58F624B7AFCF3032LL ) { result = 2;
    if ( v10[2] == 0x1C11B74D1CE8DDC2LL ) { result = 3;
      if ( v10[3] == 0xECFA4813F2A2E72ELL ) { result = 4;
        if ( v10[4] == 0x2F4251A12E327498LL ) { result = 5;
          if ( v10[5] == 0xFB9210E9AAAE7AFALL ) { result = 6;
            if ( v10[6] == 0x66B694B549D54370LL ) { result = 7;
              return (v10[7] == 0x76F9890774683B09LL) + 7; } } } } } } }
```

`sz2knf4a` uses same ladder and only decrypts when all 8 match. Game oracles `RESONANCE d/8` and `ECHO A/B = checkpoints[2]/[6]`.

**Leak 7 - FREE_P/Q = 64, STAGES = 8:** Dead code `if p > free_limit(64) || q > free_limit(64)` where `free_limit(64) == u64::MAX` is optimized away. Visible via absence of `p>q` compares in `sz2knf4a` and `RESONANCE d/8`.

**Leak 8 - SBOX 256 B at `0x5628`:** Bijective permutation used by `pad()`.

All constants for reference:

```rust
pub const SALT2: &str = "phase-loom/weave-of-one-way-gates"; // 33
pub const NONCE: [u8; 16] = [0x38, 0xF3, 0xF5, 0x7F, 0x70, 0xC3, 0x2B, 0xF9, 0xFC, 0xB9, 0x5B, 0xF1, 0x5C, 0xBB, 0x3D, 0xAA];
pub const ROT: [u32; 64] = [15,10,10,4,6,25,12,15,21,6,24,27,25,5,13,1,16,31,30,19,15,13,31,15,21,14,13,17,19,4,4,25,26,7,6,14,8,23,14,4,14,28,9,19,15,15,3,21,25,3,10,29,1,3,23,25,21,13,28,13,2,18,6,17];
pub const ADD: [u32; 64] = [0xAA9AFE6D,0x5629E00C,0x8BB7FF17,0x617A5FA4,0x52D9662A,0x0EDA82E7,0xAE451898,0x5DCEFBFD,0x70950F6E,0x094A28D6,0xBCA00A4C,0x37011D74,0x0BB02C9E,0xDA9E8255,0x294049FB,0xDFC5F977,0x85FEE217,0xE2EB2210,0x7DFE6710,0xFFFA65FE,0x81B3E4DC,0x259E0502,0xCE777C03,0x361B2CB7,0x2021E97C,0x1E15A92F,0x906057C3,0x8C9A4819,0xC1D3C795,0x027F84D4,0x49C84304,0xFE342FCA,0x0966C9A3,0x8ABBC263,0xB58821A9,0x4D0B3413,0x84170846,0x5C832267,0x990BBC1F,0xC77D1B34,0xDDC079E0,0x0A19461D,0xE45C3A4F,0x4F3F50EB,0x9B96D4B4,0x8773A6EC,0x7D795E18,0x29492C43,0xB7978621,0xC852A725,0x42E9EDB1,0xCD19F770,0xC7088700,0x96C6CF19,0xB14CD9F1,0xFB0456E7,0x28F1DB6D,0xB9057823,0xED685CCE,0xFFEF7E54,0x8BC03C04,0x60516D0C,0x98E8B223,0x375799FC];
pub const MUL: [u32; 8] = [0x812839C9,0x451BD6DD,0x26553CBF,0x64296243,0xFA0C5139,0xB4F73795,0x38D51B97,0x976CB9A1];
pub const TAG: [u64; 8] = [0xA51DF4F26E85E730,0xD88DF183495C4D3E,0xF5044BBF2EE7023F,0x55690A3FD61758AA,0x74534447C2CBCA5C,0x11D948AF4858483D,0xA81BEAA5009651BA,0x49FD15ED843C4615];
pub const STAGE_CKPT: [u64; 8] = [0x6F14B7E4DC8DFCE6,0x58F624B7AFCF3032,0x1C11B74D1CE8DDC2,0xECFA4813F2A2E72E,0x2F4251A12E327498,0xFB9210E9AAAE7AFA,0x66B694B549D54370,0x76F9890774683B09];
pub const ENCRYPTED_FLAG: [u8; 50] = [0x29,0xD9,0xA6,0xAE,0x1E,0x6E,0xC6,0xB7,0xE3,0x03,0x46,0x57,0xBA,0xE2,0x21,0xD7,0x18,0xA8,0x7A,0xB5,0xD6,0x2C,0x9A,0x47,0xF5,0x10,0xA9,0xEA,0x19,0x3B,0xAB,0xEF,0x7A,0xB3,0x20,0x94,0xF0,0xC6,0x3B,0x85,0xC8,0xB5,0xE8,0x94,0xF0,0x48,0x02,0x5F,0x52,0x0E];
```

`key = MASK_A ^ MASK_B ^ MASK_C = 0bddb8d1f16f91a592e4693d69b7b114`.

### 4. Intended solve via MT19937 state

Every constant was drawn sequentially from one `random.Random(seed)` with 128-bit seed (`secrets.randbits(128)`):

| draw | source | MT19937 words |
| --- | --- | --- |
| `p` | `getrandbits(64)` | 0,1 |
| `q` | `getrandbits(64)` | 2,3 |
| `key` | `randbytes(16)` | 4..7 |
| `mask_a` | `randbytes(16)` | 8..11 |
| `mask_b` | `randbytes(16)` | 12..15 |
| `rot[64]` | `randrange(1,32) x64` | 16..79 plus R rejects |
| `add[64]` | `getrandbits(32) x64` | 80+R .. 143+R |
| `mul[8]` | `getrandbits(32)|1 x8` | 144+R .. 151+R |
| `tag[8]` | `getrandbits(64) x8` | 152+R .. 167+R |
| `nonce` | `randbytes(16)` | 168+R .. 171+R |

`R` is total rejected draws for 64 `randrange(1,32)` (reroll on 1/32). All leaked words are consecutive outputs of one MT19937 block positions `4..171+R`; `p,q` are words `0..3` earlier in same stream. Recover seed via constraint solve (z3) on MT19937 state, not 2^128 brute force. Then replay:

```python
import random
rng = random.Random(seed)
p, q = rng.getrandbits(64), rng.getrandbits(64)
key = rng.randbytes(16)  # 0bddb8d1f16f91a592e4693d69b7b114
# p = 126835284229173436, q = 10059119762309031284
```

Verify `checkpoints = chain(p,q,key)` against 8 `STAGE_CKPT` (all 8 must match, `RESONANCE 8/8`), then decrypt:

```python
import hashlib
from Crypto.Cipher import AES
kdf = hashlib.sha256(b"phase-loom/weave-of-one-way-gates" + key + p.to_bytes(8,'little') + q.to_bytes(8,'little')).digest()
aes = AES.new(kdf, AES.MODE_CTR, nonce=b"\x38\xf3\xf5\x7f\x70\xc3\x2b\xf9"[:8], initial_value=int.from_bytes(b"\xfc\xb9\x5b\xf1\x5c\xbb\x3d\xaa", 'big'))
flag = aes.decrypt(bytes.fromhex("29d9a6ae1e6ec6b7e3034657bae221d718a87ab5d62c9a47f510a9ea193babef7ab32094f0c63b85c8b5e894f048025f520e"))
```

Decrypted flag is `encryptid{12_d3gr33s_0f_fr33d0m_bu7_0n1y_0n3_p47h}`.

The `extracted/` dir already contains the decoded bundle; `libphase_loom_core.so.c` and `libphase_loom_core-objdump.txt` are the primary references for all addresses. `ECHO A/B` leak `checkpoints[2]/[6]` as u32 halves but are not needed for the MT19937 solve.

The solve script can be found [here](./solve.py).

## Flag

```
encryptid{12_d3gr33s_0f_fr33d0m_bu7_0n1y_0n3_p47h}
```

*Writeup written by Aarav Juneja*
