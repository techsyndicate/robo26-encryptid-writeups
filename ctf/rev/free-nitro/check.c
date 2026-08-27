#include <stdint.h>
#include "aes.h"
#include "flag_embed.inc"
#define EXPORT(name) __attribute__((export_name(#name)))
#define SCH_A 0x9E3779B97F4A7C15ULL
#define SCH_B 0xB7E151628AED2A6BULL

static const char DECOY_FLAG[] __attribute__((used)) =
    "encryptid{0_this_1s_n0t_th3_r34l_fl4g}";
static uint8_t input_buf[64];
static uint8_t out_buf[80];
static uint32_t out_len;
static inline uint64_t mix64(uint64_t x) {
    x += 0x9E3779B97F4A7C15ULL;
    x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
    x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
    return x ^ (x >> 31);
}
static inline uint64_t master_key(void) {
    return mix64(MSA ^ MSB) ^ SCH_B;
}
static void aes_keygen(uint8_t key[32]) {
    uint64_t x = master_key() ^ SCH_A;
    int i, b;
    for (i = 0; i < 4; ++i) {
        x = mix64(x);
        for (b = 0; b < 8; ++b) key[8 * i + b] = (uint8_t)(x >> (8 * b));
    }
}
static void forward_verify(const uint8_t *in, uint8_t *ct, uint8_t tag[16]) {
    uint8_t key[32];
    aes_keygen(key);
    aes256_gcm_encrypt(key, (const uint8_t *)NONCE, in, FLAG_LEN, ct, tag);
}
static uint32_t ct_eq(const volatile uint8_t *a, const volatile uint8_t *b, uint32_t n) {
    uint8_t d = 0;
    uint32_t i;
    for (i = 0; i < n; ++i) d |= (uint8_t)(a[i] ^ b[i]);
    return d == 0;
}
static inline uint32_t mix32(uint32_t x) {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return x;
}
EXPORT(get_input_buf) uint32_t get_input_buf(void) { return (uint32_t)(uintptr_t)input_buf; }
EXPORT(get_output_buf) uint32_t get_output_buf(void) { return (uint32_t)(uintptr_t)out_buf; }
EXPORT(get_gift) uint32_t get_gift(uint32_t seed, uint32_t persona) {
    static const char PREFIX[] = "https://discord.com/gifts/";
    static const char ALPHA[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    static const uint8_t SET = 62;
    static const uint8_t CODE_LEN = 25;
    uint32_t s = seed;
    uint32_t i, k;
    for (i = 0; i < 8; ++i) s = mix32(s ^ (persona >> (4 * (i % 8))));
    k = 0;
    for (i = 0; i < sizeof(PREFIX) - 1; ++i) out_buf[k++] = (uint8_t)PREFIX[i];
    for (i = 0; i < CODE_LEN; ++i) {
        s = mix32(s);
        out_buf[k++] = (uint8_t)ALPHA[s % SET];
    }
    out_len = k;
    return out_len;
}
EXPORT(verify_token) uint32_t verify_token(uint32_t len) {
    uint8_t ct[FLAG_LEN], tag[16];
    uint32_t i;
    if (len != FLAG_LEN) return 0;
    forward_verify(input_buf, ct, tag);
    if (!ct_eq(ct, AES_CT, FLAG_LEN)) return 0;
    if (!ct_eq(tag, AES_TAG, 16)) return 0;
    out_len = FLAG_LEN;
    for (i = 0; i < FLAG_LEN; ++i) out_buf[i] = input_buf[i];
    return 1;
}
EXPORT(get_output_len) uint32_t get_output_len(void) { return out_len; }