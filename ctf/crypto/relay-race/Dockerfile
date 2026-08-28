FROM node:22-alpine

WORKDIR /app

COPY src/package.json ./
COPY src/curve.js ./
COPY src/http-wire.js ./
COPY src/crypto-state.js ./
COPY src/server.js ./
COPY src/edge.js ./
COPY docker-entrypoint.sh /usr/local/bin/start-challenge

RUN chmod +x /usr/local/bin/start-challenge

ENV PORT1=3000
ENV PORT2=8080
EXPOSE 8080

CMD ["/usr/local/bin/start-challenge"]
