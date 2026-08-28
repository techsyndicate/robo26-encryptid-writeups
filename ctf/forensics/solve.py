#!/usr/bin/env python3
import collections
import glob
import os
import re
import string
import subprocess
import tempfile
import zipfile

alpha = string.printable.encode()

targets = {}
crcs = []
limit = 0

files = sorted(glob.glob("/tmp/crook/part_*.zip"))

if not files:
    os.makedirs("/tmp/crook", exist_ok=True)
    zipfile.ZipFile("ctf/forensics/crazy-crook.zip").extractall("/tmp/crook")
    files = sorted(glob.glob("/tmp/crook/part_*.zip"))

for zn in files:
    for info in zipfile.ZipFile(zn).infolist():
        targets[f"{zn} / {info.filename}"] = (info.CRC, info.file_size)
        crcs.append((info.CRC, info.file_size))
        limit = max(limit, info.file_size)

code = r'''
#include <bits/stdc++.h>
using namespace std;
uint32_t T[256];
void mk(){for(int i=0;i<256;i++){uint32_t c=i;for(int j=0;j<8;j++)c=c&1?0xedb88320^(c>>1):c>>1;T[i]=c;}}
uint32_t nxt(uint32_t c,char b){return T[(c^b)&0xff]^(c>>8);}
const char A[]={'''+','.join(map(str,alpha))+r'''};
const int L='''+str(limit)+r''';
array<set<uint32_t>,'''+str(limit+1)+r'''> S;
string st;
void dfs(uint32_t c){
    if(S[st.size()].count(c^0xffffffff)){
        printf("%08x ",c^0xffffffff);
        for(char ch:st) printf(" %02x",(unsigned char)ch);
        printf("\n");
    }
    if((int)st.size()<L) for(char ch:A){
        st.push_back(ch);
        dfs(nxt(c,ch));
        st.pop_back();
    }
}
int main(){
    mk();'''

for c, s in crcs:
    code += f'S[{s}].insert(0x{c:08x});\n'

code += 'dfs(0xffffffff);}'

with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, 'a.cpp')
    b = os.path.join(d, 'a.out')
    open(p, 'w').write(code)
    subprocess.check_call(['g++', '-std=c++11', '-O3', '-o', b, p])
    out = subprocess.check_output([b]).decode()

res = collections.defaultdict(list)

for l in out.splitlines():
    if l:
        c, *v = map(lambda x: int(x, 16), l.split())
        res[(c, len(v))].append(bytes(v))

def key_num(k):
    m = re.search(r'part_(\d+)', k)
    return int(m.group(1)) if m else 0

ordered = sorted(targets, key=key_num)

url = ''.join(res[targets[k]][0].decode() for k in ordered)

for k in ordered:
    name = k.split(" / ")[-1]
    print(f"{name} : {repr(res[targets[k]][0])[1:]}")

print(url)
