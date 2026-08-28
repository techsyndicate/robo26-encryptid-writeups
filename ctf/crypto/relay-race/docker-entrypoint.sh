#!/bin/sh
set -eu

node /app/server.js &
origin_pid=$!

cleanup() {
  kill "$origin_pid" 2>/dev/null || true
}

trap cleanup INT TERM EXIT
exec node /app/edge.js
