#!/bin/sh
set -eu

: "${STUDIO_HOST:?STUDIO_HOST is required (e.g. singlestore.guestway.io)}"
: "${REMOTE_DB_HOST:=127.0.0.1}"
: "${REMOTE_DB_PORT:=3306}"
: "${TUNNEL_LISTEN_PORT:=3306}"

# Auth: prefer Cloudflare Access service token (long-lived, daemon-friendly).
# Fall back to a CF_Authorization cookie for short-lived dev runs.
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  set -- \
    --binary \
    -E \
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
    "tcp-listen:0.0.0.0:${TUNNEL_LISTEN_PORT}" \
    "wss://${STUDIO_HOST}/proxy?hostname=${REMOTE_DB_HOST}&port=${REMOTE_DB_PORT}"
elif [ -n "${CF_AUTHORIZATION:-}" ]; then
  echo "tunnel: using CF_Authorization cookie (dev only; expires in ~24h)" >&2
  set -- \
    --binary \
    -E \
    -H "Cookie: CF_Authorization=${CF_AUTHORIZATION}" \
    "tcp-listen:0.0.0.0:${TUNNEL_LISTEN_PORT}" \
    "wss://${STUDIO_HOST}/proxy?hostname=${REMOTE_DB_HOST}&port=${REMOTE_DB_PORT}"
else
  echo "tunnel: no Cloudflare Access credentials provided" >&2
  echo "tunnel: set CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (recommended)" >&2
  echo "tunnel: or CF_AUTHORIZATION (dev only)" >&2
  exit 2
fi

echo "tunnel: bridging tcp-listen:0.0.0.0:${TUNNEL_LISTEN_PORT} <-> wss://${STUDIO_HOST}/proxy?hostname=${REMOTE_DB_HOST}&port=${REMOTE_DB_PORT}" >&2

# websocat's tcp-listen is single-shot. Loop so the MCP pool can re-dial after
# each MySQL connection closes. -E (--exit-on-eof) makes websocat exit cleanly
# when the MySQL client closes its socket.
while :; do
  websocat "$@" || true
  sleep 0.5
done
