# Easy Pwn

## Challenge Info

**Points:** 250
**Difficulty:** Easy
**Challenge Description:**

```
The flag is at /root/flag. Connect with nc 20.219.0.137 3002
```

## Recon

We are given a netcat instance, with a shell prompt in a Linux box. The shell has no outbound internet.

Initial privilege escalation checks show a normal kernel version and a small set of loaded modules. The SUID search is the first real lead:

```
$ find / -perm -4000 -type f
/usr/local/libexec/syscheck
```

Listing the helper binary:

```
$ ls -l /usr/local/libexec/syscheck
-rwsr-xr-x 1 root root ... /usr/local/libexec/syscheck

$ cat /usr/local/libexec/syscheck.c
```

The helper is tiny:

```c
if (geteuid() != 0) return 1;
puts("maintenance check complete");
```

SUID stands for Set User ID which is a file permission flag in Linux. It allows an executable file to run with the permissions of the file's owner rather than the user who launched it. `syscheck` is root owned (SUID 04755 -rwsr-xr-x) and does nothing except check effective uid. `/usr/bin/su` is 0755 and not SUID in this configuration so the public`/usr/bin/su` path is dead.

[LinPEAS](https://github.com/peass-ng/PEASS-ng/tree/master/linPEAS) gives the same conclusion in one run and is useful to confirm that we did not miss anything. It is a single Bash script that sweeps read only checks like `sudo -l`, `find -perm -4000`, `getcap -r /`, `cat /etc/crontab`, world writable files and kernel version, and ranks findings for likely privesc.

Quick run inside the box:

```bash
$ curl -L https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh -o linpeas.sh
$ base64 -w0 linpeas.sh # then upload via shell using base64 -d to /tmp/linpeas.sh
$ chmod +x /tmp/linpeas.sh; /tmp/linpeas.sh -a | tee /tmp/out
$ /tmp/linpeas.sh -s
```

LinPEAS flags kernel `6.8.0-31` as vulnerable to [DirtyFrag](https://github.com/V4bel/dirtyfrag), highlights `/usr/local/libexec/syscheck` as the only useful SUID and confirms modules and empty capabilities.

## Exploitation

1. Enumerate the helper at `/usr/local/libexec/syscheck`.
2. Change `TARGET_PATH "/usr/bin/su"` to `"/usr/local/libexec/syscheck"` and adjust launch and verify paths. The 192 byte ELF is reusable as is.
3. Use `unshare` and register 48 XFRM states each carrying one 4 byte chunk of the ELF in `seq_hi`. For each chunk run `do_one_write` at `PATCH_OFFSET 0` to overwrite the file from offset 0. Each write does `vmsplice(pipe, hdr)` + `splice(fd, off, pipe, 16)` + `splice(pipe, udp, 40)`.
4. Read back bytes at `0x78` from the helper and check for `0x31 0xff`.
5. The helper is now a tiny root shell ELF. Running it gives a root shell directly:

```bash
$ /usr/local/libexec/syscheck
$ id
# uid=0(root)
$ cat /root/flag
```

The solve script can be found [here](./solve.py).

## Flag

```
encryptid{lpe_d1r7y_fr4gg1ng_63f4945d921d599f27ae4fdf5bada3f1}
```

*Writeup written by Aarav Juneja*
