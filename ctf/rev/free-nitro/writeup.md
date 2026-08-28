# Free Nitro

## Challenge Info

**Category**: Reverse Engineering   
**Points:** 250   
**Challenge Description:**

```
Do you want free nitro? Here you go! https://nitro.squeakyfiddlepro.me/
```

## Recon

The given website is a fake Nitro gift generator. `src/app.js` does not have the check for flag, instead it fetches a WASM bundle at runtime via `loadBundle` in `src/app.js`:

```js
resp = await fetch("/api/bundle", { headers: { "x-nitro-fp": fingerprintCookie } })
b64 = (await resp.json()).data // NITRO_BASE64
bytes = base64ToBytes(b64)
mod = new WebAssembly.Module(bytes); wasm = new WebAssembly.Instance(mod).exports
```

`/api/bundle` only returns `200 {data:NITRO_BASE64}` after `sessionOk` passes. The cookie is minted only after passing captcha.

After doing the captcha and bundle thingie you get:

```js
export const NITRO_BASE64 = "AGFzbQEAAAABFgRgAAF/YAJ/fwF/YAF/AX9gA39/fwADBwYAAAECAAMFAwEAAgYIAX8BQcCXB..."
```

An actual extraction would look like:

```bash
$ curl -s https://nitro.squeakyfiddlepro.me/api/bundle -H "Cookie: nitro_sess=..." -H "x-nitro-fp: fp_..." | jq -r .data | base64 -d > bundle.wasm
```

After you get the wasm the real reversing starts.

`wasm-objdump -x src/bundle.wasm` shows a tiny module with 2 pages of memory and 6 exports:

```
Type[4] Function[6] Memory[1] pages: initial=2 Global[1] Export[6] Data[6] Code[6]
Export: memory -> "memory", func[0] -> "get_input_buf", func[1] -> "get_output_buf",
        func[2] -> "get_gift", func[3] -> "verify_token", func[4] -> "get_output_len"
```

`func 0` returns `2848` for the input buffer, `func 1` returns `2912` for the output buffer, `func 4` loads the output length from `2992`. The only interesting ones are `get_gift` and `verify_token`.

```js
const p = wasm.get_input_buf(); for(i) v.setUint8(p+i, str.charCodeAt(i)); wasm.verify_token(len);
const out = readOut(); // get_output_buf + get_output_len
```

All the secrets are just sitting in the data segments at `1024`:

```
segment[0] @1024 size 400: 07 67 f0 f0 36 17 22 02 26 d9 34 81 e1 a7 cb 31
                            1a d0 0f fe 42 9b e5 77 0c 90 a6 33 00...
                            23 70 57 aa 8a 59 9f 98 5a de 19 70...
                            82 8f b7 a8 60 b1 3b 54 d8 e7 1d 72 7d b2 14 1f
segment[5] @2480 "https://discord.com/gifts/\0...ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\0..."
           + SBOX[256] at 2512, RCON etc
```

If you parse that first segment you get everything:

```
MSA  = 0x02221736F0F06707 (1024)
MSB  = 0x31CBA7E18134D926 (1032)
NONCE = 1a d0 0f fe 42 9b e5 77 0c 90 a6 33 (1040)
AES_CT[64] = 23 70 57 aa 8a 59 9f 98 5a de 19 70 74 e3 34 14 e1 58 a4 85 ... e7 50 b9 69 (1052)
AES_TAG[16] = 82 8f b7 a8 60 b1 3b 54 d8 e7 1d 72 7d b2 14 1f (1116)
```

WebAssembly modules cannot be read directly by humans (without AI) because they are compact and optimized for fast parsing and execution by the browser. Thus, we first bring it down to WebAssembly Text format which translates the binary instructions into a more readable form:

```bash
$ wasm2wat src/bundle.wasm -o src/bundle.wat
```

If the wasm encoding isn't tuff then you may even get a direct clean c code:

```bash
$ wasm2c src/bundle.wasm -o src/bundle.c
```

Some relevant stuff from reading the wat file:

```wat
(memory (;0;) 2) // 2 pages = 128 KiB

(export "memory" (memory 0))
(export "get_input_buf" (func 0))
(export "get_output_buf" (func 1))
(export "get_gift" (func 2))
(export "verify_token" (func 3))
(export "get_output_len" (func 4))

(data (;0;) (i32.const 1024) "\07g\f0...") // msa+msb+nonce+ct+tag
```

each `data` at `1024`, `2480` etc maps to secrets and tables.

`func 3` is `verify_token` and it is super straightforward once you decompile it:

```wat
(func (;3;) (type 2) (param i32) (result i32)
  (local i64 i64 ... i32 ...)
  global.get 0; i32.const 112; i32.sub; local.tee 17; global.set 0
  local.get 0; i32.const 64; i32.ne; if (return 0) end
  ;; mix64 chain
  local.get 17; i32.const 1024; i64.load; i32.const 1032; i64.load; i64.xor
  i64.const 7046029254386353131; i64.sub; ... i64.mul -4658895280553007687 ...
  ;; aes_keygen: master_key = mix64(MSA^MSB) ^ SCH_B; x = master_key ^ SCH_A
  ;; for i 0..3 x=mix64(x); key[8*i+b]=x>>(8*b) (little endian)
  ;; forward_verify: aes256_gcm_encrypt(key, NONCE, input_buf, 64, ct, tag)
  ;; ct_eq(ct, AES_CT,64) && ct_eq(tag,AES_TAG,16); then copy input to out_buf; return 1
)
```

`func 5` is the crypto part aka AES GCM. It has `SBOX`, `RCON`, `aes_expand` (240 bytes for 14 rounds), `aes_encrypt_block` and the GCM parts `gf_mul`, `load128`, `inc32`, `H=AES_K(0)`, `J0=IV||0001`. The `mix64` it uses is visible directly in `src/bundle.wat` (`verify_token`):

```wat
local.get 17
i32.const 1024
i64.load
i32.const 1032
i64.load
i64.xor
i64.const 7046029254386353131
i64.sub
local.tee 1
i64.const 30
i64.shr_u
local.get 1
i64.xor
i64.const -4658895280553007687
i64.mul
local.tee 1
i64.const 27
i64.shr_u
local.get 1
i64.xor
i64.const -7723592293110705685
i64.mul
...
local.get 1
i64.const 31
i64.shr_u
i64.xor
```

which is `x += 0x9E3779B97F4A7C15; x=(x^x>>30)*0xBF58476D1CE4E5B9; x=(x^x>>27)*0x94D049BB133111EB; return x^x>>31`.

`SCH_A 0x9E3779B97F4A7C15` and `SCH_B 0xB7E151628AED2A6B` show up as `i64.const` in there. `get_gift` is just useless unless you want to try your luck for a free nitro (it worked for me, trust).

## Exploitation

So `verify_token` just does `len !=64 -> fail` then `forward_verify` which is `aes_keygen` + `aes256_gcm_encrypt` and compares, as in `src/bundle.c`:

```c
// forward_verify(input_buf, ct, tag); // aes_keygen + aes256_gcm_encrypt(NONCE)
w2c_bundle_f5(instance, var_i0, var_i1, var_i2);

// if (!ct_eq(ct, AES_CT,64)) return 0;
var_i0 = var_i0 != var_i1;
if (var_i0) {goto var_B0;}

// if (!ct_eq(tag, AES_TAG,16)) return 0;
var_i0 = var_i0 != var_i1;
if (var_i0) {goto var_B0;}

// out_len=64; memcpy(out_buf, input_buf,64); return 1;
memory_copy(&instance->w2c_memory, &instance->w2c_memory, var_i0, var_i1, var_i2);
```

`aes_keygen` as in `src/bundle.c`:

```c
// master_key = mix64(MSA ^ MSB) ^ SCH_B
var_j1 ^= var_j2;
var_j2 = 7046029254386353131ull;
var_j1 -= var_j2;

// x = master_key ^ SCH_A
var_j2 = 11400714785082723349ull;
var_j1 ^= var_j2;

// for i 0..3: x=mix64(x);
var_j2 = var_l1;
var_j1 ^= var_j2;
var_j2 = 13787848793156543929ull;
var_j1 *= var_j2;

// for b 0..7 key[8*i+b]= x >> (8*b)
var_j2 = 8ull;
var_j1 >>= (var_j2 & 63);
i64_store8(&instance->w2c_memory, (u64)(var_i0) + 89, var_j1);
```

Everything you need is already in the wasm data so you just compute the key and decrypt:

```
key = 10080343f2dd61deae3a1cbe53ec3c4e012e6e0d78f97e15aec2929d19c5e393
NONCE = 1ad00ffe429be5770c90a633
J0 = 1ad00ffe429be5770c90a63300000001, no AAD, GHASH only over ciphertext+len
```

Then it is just standard `AES.MODE_GCM` decrypt of `AES_CT`/`AES_TAG` and you get the flag. The solve script can be found [here](./solve.py).

## Flag

```
encryptid{th3_fr33_n1tr0_w4s_th3_fr13nd5_y0u_m4d3_4l0ng_th3_w4y}
```

*Writeup written by Aarav Juneja*
