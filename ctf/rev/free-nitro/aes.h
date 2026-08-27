#ifndef NITRO_AES_H
#define NITRO_AES_H

#include <stdint.h>

void aes256_gcm_encrypt(const uint8_t key[32], const uint8_t iv[12],
                        const uint8_t *in, uint32_t inlen,
                        uint8_t *out, uint8_t tag[16]);

#endif
