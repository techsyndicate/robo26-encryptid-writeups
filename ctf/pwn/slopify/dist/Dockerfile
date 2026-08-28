FROM ubuntu:25.10

WORKDIR /app
RUN apt update && apt install -y socat && rm -rf /var/lib/apt/lists/*
RUN useradd ctf

COPY program .
COPY flag.txt .
RUN chmod 444 flag.txt 
RUN chmod 555 program 
ENV FLAG="encryptid{REDACTED}"

USER ctf

CMD ["socat", "-v", "TCP-LISTEN:3000,reuseaddr,fork", "EXEC:'bash -c \"stty raw -echo; ./program\"',pty,setsid,stderr"]
