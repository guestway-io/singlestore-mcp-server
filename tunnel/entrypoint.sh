#!/bin/sh
set -eu

: "${STUDIO_HOST:?STUDIO_HOST is required (e.g. singlestore.guestway.io)}"
: "${REMOTE_DB_HOST:=127.0.0.1}"
: "${REMOTE_DB_PORT:=3306}"
: "${TUNNEL_LISTEN_PORT:=3306}"

URL="wss://${STUDIO_HOST}/proxy?hostname=${REMOTE_DB_HOST}&port=${REMOTE_DB_PORT}"
LISTEN="tcp-l:0.0.0.0:${TUNNEL_LISTEN_PORT}"

# Auth: prefer Cloudflare Access service token (long-lived, daemon-friendly).
# Fall back to a CF_Authorization cookie for short-lived dev runs.
# Header flags placed AFTER the URLs to match the parser shape websocat 1.13
# expects (matches the export-org.nu reference invocation).
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  set -- \
    --binary -q \
    "$LISTEN" "$URL" \
    --header "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    --header "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
elif [ -n "${CF_AUTHORIZATION:-}" ]; then
  echo "tunnel: using CF_Authorization cookie (dev only; expires in ~24h)" >&2
  set -- \
    --binary -q \
    "$LISTEN" "$URL" \
    --header "Cookie: CF_Authorization=${CF_AUTHORIZATION}"
else
  echo "tunnel: no Cloudflare Access credentials provided" >&2
  echo "tunnel: set CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET (recommended)" >&2
  echo "tunnel: or CF_AUTHORIZATION (dev only)" >&2
  exit 2
fi

echo "tunnel: bridging ${LISTEN} <-> ${URL}" >&2

# websocat tcp-l is single-shot. Loop so the MCP pool can re-dial after each
# MySQL connection closes.
while :; do
  websocat "$@" || true
  sleep 0.5
done
