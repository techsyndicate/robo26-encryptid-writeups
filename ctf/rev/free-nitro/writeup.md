# Free Nitro

## Challenge Info

**Points:** 250  
**Difficulty:** Easy  
**Challenge Description:**

```
Do you want free nitro? Here you go! https://nitro.squeakyfiddlepro.me/
```

## Recon

The site is a fake Nitro gift page that loads a WASM crackme. `dist/app.js` loads `/api/bundle` as base64 WASM. The API serves `NITRO_BASE64` only after `sessionOk` checks `nitro_sess` cookie `HMAC-SHA256(SESSION_SECRET)` plus `x-nitro-fp` and recaptcha. `dist/app.js` fetches `/api/bundle` with `x-nitro-fp`, verifies `SHA256(bytes) == WASM_SHA256`, then instantiates the WASM via `WebAssembly.Module` and `WebAssembly.Instance`.

The actual check lives in `check.c` compiled to WASM (`api/_data/bundle.data.js` is the base64 of that module). Exports are:

```bash
$ grep -n "EXPORT" check.c
EXPORT(get_input_buf) uint32_t get_input_buf(void)
EXPORT(get_output_buf) uint32_t get_output_buf(void)
EXPORT(get_gift) uint32_t get_gift(uint32_t seed, uint32_t persona)
EXPORT(verify_token) uint32_t verify_token(uint32_t len)
EXPORT(get_output_len) uint32_t get_output_len(void)
```

The flag length is `FLAG_LEN = 64` in `flag_embed.inc`. Secrets are in `flag_embed.inc`:

```c
static const uint64_t volatile MSA = 0x02221736F0F06707ULL;
static const uint64_t volatile MSB = 0x31CBA7E18134D926ULL;
static const uint8_t volatile NONCE[12] = {0x1A,0xD0,0x0F,0xFE,0x42,0x9B,0xE5,0x77,0x0C,0x90,0xA6,0x33};
static const uint8_t volatile AES_CT[64] = {0x23,0x70,0x57,0xAA,...};
static const uint8_t volatile AES_TAG[16] = {0x82,0x8F,0xB7,0xA8,...};
```

`check.c` defines `SCH_A 0x9E3779B97F4A7C15ULL` and `SCH_B 0xB7E151628AED2A6BULL`. The key schedule is `aes_keygen` in `check.c`, verification is `forward_verify` in `check.c` calling `aes256_gcm_encrypt` from `aes.c`, and constant-time compare `ct_eq` in `check.c`.

`aes.c` is a self-contained AES-256 (`SBOX`, `RCON_`, `aes_expand` with `240` bytes `4*15` rounds) plus `GCM` (`gf_mul`, `load128`, `inc32`, `aes256_gcm_encrypt`). This matches standard AES-GCM, so we can use `AES.MODE_GCM` offline.

`get_gift` in `check.c` is unrelated to the flag - it builds `https://discord.com/gifts/` plus 25 chars from `ALPHA 62` via `mix32` in `check.c` seeded by `seed ^ persona`. This is the fake Nitro link minted by the site via `wasm.get_gift(seed, persona)`.

WASM memory helpers are `view = new DataView(wasm.memory.buffer)`, `get_input_buf`/`get_output_buf`, `writeIn(str)` and `readOut()`:

```js
const p = wasm.get_input_buf();
for (i) v.setUint8(p+i, str.charCodeAt(i));
wasm.verify_token(len);
const out = readOut(); // get_output_buf + get_output_len
```

## Exploitation

The verifier in `check.c` rejects `len != 64` then does `forward_verify` in `check.c`:

```c
forward_verify(input_buf, ct, tag);
if (!ct_eq(ct, AES_CT, 64)) return 0;
if (!ct_eq(tag, AES_TAG, 16)) return 0;
```

`forward_verify` derives the key in `check.c` `aes_keygen` from `flag_embed.inc` `MSA 0x02221736F0F06707` `MSB 0x31CBA7E18134D926` and `SCH_A 0x9E3779B97F4A7C15` `SCH_B 0xB7E151628AED2A6BULL` in `check.c`:

```c
master_key = mix64(MSA ^ MSB) ^ SCH_B
x = master_key ^ SCH_A
for i 0..3:
 x = mix64(x) // mix64 at check.c
 for b 0..7 key[8*i+b] = x >> (8*b)
```

`mix64` is `x += 0x9E3779B97F4A7C15; x = (x ^ x>>30)*0xBF58476D1CE4E5B9; x = (x ^ x>>27)*0x94D049BB133111EB; return x ^ x>>31` in `check.c`. Each 64-bit pair gives one deterministic 32-byte key, so a WASM scan only needs to try both orders `aes_key_bytes(A,B)` and `aes_key_bytes(B,A)` for the six 16-byte blocks before the nonce (`6*2 = 12` candidates) instead of 2^128.

`aes.c` is a full AES-256 (`SBOX`, `aes_expand` with `60` words for 14 rounds) plus GCM in `aes.c` (`H = AES_K(0)` in `aes.c`, `J0 = IV || 0001` in `aes.c`, `inc32` + `aes_encrypt_block` for CTR in `aes.c`, `GHASH` via `gf_mul` in `aes.c`). For this challenge `NONCE` in `flag_embed.inc` is `1a d0 0f fe 42 9b e5 77 0c 90 a6 33` so `J0 = 1a d0 0f fe 42 9b e5 77 0c 90 a6 33 00 00 00 01`. There is no AAD - GHASH only covers `ciphertext` plus length in `aes.c`, so it is standard `AES-GCM` and offline `AES.MODE_GCM` works.

Everything needed is client side: `WASM` contains `NONCE 12` in `flag_embed.inc`, `MSA/MSB 8+8` in `flag_embed.inc`, `AES_CT 64` in `flag_embed.inc` and `AES_TAG 16` in `flag_embed.inc` with source making it even clearer. The flag is just the GCM plaintext for those values.

With source we derive directly `key = 10080343f2dd61deae3a1cbe53ec3c4e012e6e0d78f97e15aec2929d19c5e393` and decrypt.

The solve script can be found [here](./solve.py).

## Flag

```
encryptid{th3_fr33_n1tr0_w4s_th3_fr13nd5_y0u_m4d3_4l0ng_th3_w4y}
```

*Writeup written by Aarav Juneja*
