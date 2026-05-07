# Guestway SingleStore MCP server

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server
for SingleStore. Used at Guestway to let Claude Desktop (and any other MCP
client) explore our SingleStore database without giving it write access.

Forked from
[`madhukarkumar/singlestore-mcp-server`](https://github.com/madhukarkumar/singlestore-mcp-server)
in May 2026; the fork is essentially a rewrite (security hardening, dropped
write tools, Streamable HTTP transport, modular code, vendored CA bundle).
See [`CHANGELOG.md`](CHANGELOG.md) for the full diff.

## What it exposes

Five read-only tools, all annotated with `readOnlyHint: true`:

| Tool                   | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `list_tables`          | List tables in the configured database.                                  |
| `describe_table`       | Schema, row count, 5-row sample. Identifier validated.                   |
| `run_read_query`       | Run a single SELECT (or pure-SELECT CTE). Capped at 1000 rows.           |
| `generate_er_diagram`  | Mermaid `erDiagram` derived from `information_schema`.                   |
| `optimize_sql`         | `PROFILE` a SELECT, return summary, bottlenecks, and recommendations.    |

`run_read_query` and `optimize_sql` are gated by `node-sql-parser` plus a
forbidden-token backstop. Stacked statements, DDL, DML, `SET`,
`SELECT ... FOR UPDATE`, and `INTO OUTFILE` are all rejected.

## Architecture (Guestway deployment)

```
Claude Desktop (laptop)
    │  stdio
    ▼
mcp-remote
    │  HTTPS + bearer (Streamable HTTP)
    ▼
guestway-singlestore-mcp  ← Mac mini, Docker
    │  plain TCP MySQL on tunnel:3306
    ▼
tunnel sidecar (websocat)  ← Docker network neighbor
    │  wss + Cloudflare Access service-token headers
    ▼
Cloudflare Access edge ──► EC2: SingleStore Studio + cloudflared
                                   │  TCP 3306
                                   ▼
                            SingleStore cluster
```

The `tunnel` sidecar piggy-backs on Studio's built-in
`wss://${STUDIO_HOST}/proxy?hostname=&port=` endpoint, which is plain
raw-TCP-over-WebSocket framing. Same path `export-org.nu` uses; no custom
protocol code. See [Tunnel](#tunnel-mac-mini--singlestore-via-studios-proxy).

## Requirements

- Node.js 20+ (Docker image pins Node 22).
- A reachable MySQL endpoint. The reference Guestway deployment uses the
  Studio `/proxy` tunnel described below; pointing the MCP at a direct
  TCP+TLS Helios host also works (set `SINGLESTORE_HOST` directly and turn
  the sidecar off).
- A SingleStore user with **read-only** privileges. Do not point this
  server at a user that can write or DDL.

## Configuration

Copy `.env.example` to `.env` and edit.

**Tunnel + Cloudflare Access:**

| Var                        | Description                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `STUDIO_HOST`              | Studio hostname (e.g. `singlestore.guestway.io`). Sidecar dials `wss://STUDIO_HOST/proxy`. |
| `REMOTE_DB_HOST`           | DB host as Studio sees it. Defaults to `127.0.0.1`.                                   |
| `REMOTE_DB_PORT`           | DB port as Studio sees it. Defaults to `3306`.                                        |
| `CF_ACCESS_CLIENT_ID`      | Cloudflare Access service-token Client ID. Recommended.                               |
| `CF_ACCESS_CLIENT_SECRET`  | Cloudflare Access service-token Client Secret.                                        |
| `CF_AUTHORIZATION`         | Optional dev fallback: value of the `CF_Authorization` cookie from a browser session. |

**SingleStore connection (through the tunnel by default):**

| Var                       | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `SINGLESTORE_HOST`        | `tunnel` when using the sidecar; a real host when bypassing it.        |
| `SINGLESTORE_PORT`        | Defaults to `3306`.                                                    |
| `SINGLESTORE_USER`        | A read-only role.                                                      |
| `SINGLESTORE_PASSWORD`    | Password.                                                              |
| `SINGLESTORE_DATABASE`    | Database name.                                                         |

**SingleStore TLS (optional; off by default):**

| Var                                   | Default | Notes                                                                                  |
| ------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `SINGLESTORE_TLS`                     | `false` | Flip on if your cluster's MySQL port speaks TLS.                                       |
| `SINGLESTORE_TLS_SERVERNAME`          | _unset_ | SNI override so mysql2 verifies the cert against the cluster name, not `tunnel`.       |
| `SINGLESTORE_TLS_REJECT_UNAUTHORIZED` | `true`  | Last-resort escape hatch for self-signed clusters. Logs a loud `WARN` when set false.  |

**HTTP transport (opt-in; stdio always works for local Claude Desktop):**

| Var                      | Default       | Notes                                                                             |
| ------------------------ | ------------- | --------------------------------------------------------------------------------- |
| `MCP_HTTP_ENABLED`       | `false`       | Set to `true` for remote clients.                                                 |
| `MCP_HTTP_HOST`          | `127.0.0.1`   | Refuses to bind to a non-loopback host without `MCP_BEARER_TOKEN`.                |
| `MCP_HTTP_PORT`          | `8081`        |                                                                                   |
| `MCP_BEARER_TOKEN`       | _unset_       | Required for non-loopback. Generate with `openssl rand -hex 32`.                  |
| `MCP_ALLOWED_ORIGINS`    | _unset_       | Comma-separated CORS allowlist. Empty = deny all browser origins.                 |
| `MCP_ALLOWED_HOSTS`      | _unset_       | Comma-separated `Host`-header allowlist (DNS-rebinding defense).                  |
| `MCP_RATE_LIMIT_PER_MIN` | `120`         | Per-IP requests per minute against `/mcp`.                                        |
| `MCP_BODY_LIMIT`         | `256kb`       | Max request body.                                                                 |
| `LOG_LEVEL`              | `info`        | `pino` levels.                                                                    |

## Local development

```bash
npm install
npm run build
npm test                   # runs SQL guard tests
SINGLESTORE_HOST=... SINGLESTORE_USER=... SINGLESTORE_PASSWORD=... \
SINGLESTORE_DATABASE=... npm start
```

`npm run inspect` launches `@modelcontextprotocol/inspector` against the
stdio binary for interactive testing.

## Docker (Guestway Mac mini)

```bash
cp .env.example .env
# edit .env

docker compose build
docker compose up -d
docker compose logs -f mcp
```

Health: `curl http://<mini-ip>:8081/healthz`.

The published Streamable HTTP endpoint is `POST /mcp`.

## Wiring Claude Desktop

Use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) on the laptop
to bridge stdio to the Mac mini's HTTP endpoint.

```json
{
  "mcpServers": {
    "guestway-singlestore": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://<mini-ip>:8081/mcp",
        "--header",
        "Authorization: Bearer <MCP_BEARER_TOKEN>"
      ]
    }
  }
}
```

For purely local stdio use (no Mac mini), point `command` at
`node build/index.js` and provide `SINGLESTORE_*` in `env`.

## Tunnel: Mac mini → SingleStore via Studio's `/proxy`

`mysql2` only speaks the MySQL wire protocol over TCP. Guestway prod
doesn't expose port 3306 directly; instead, SingleStore Studio sits behind
Cloudflare Access at `singlestore.guestway.io` and exposes a generic
raw-TCP-over-WebSocket endpoint at `/proxy?hostname=&port=`. The `tunnel`
sidecar bridges the MCP container's TCP traffic into that WebSocket using
[`websocat`](https://github.com/vi/websocat) — exactly the same way
`export-org.nu` does it.

### One-time Cloudflare setup

1. Open Zero Trust > Access > Applications and edit the existing
   `singlestore.guestway.io` application.
2. Add a **Service Auth** policy (Action: Service Auth) that allows your
   service token. Save.
3. Open Zero Trust > Access > Service Auth > **Create service token**.
   Name it (e.g. `mcp-mac-mini`), pick a long expiry, and copy the Client
   ID + Client Secret immediately — the secret is shown once.
4. Drop the Client ID and Secret into your `.env` as `CF_ACCESS_CLIENT_ID`
   and `CF_ACCESS_CLIENT_SECRET`.

### Bring up the stack

```bash
cp .env.example .env
# fill in STUDIO_HOST, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET,
# SINGLESTORE_USER/PASSWORD/DATABASE, and MCP_BEARER_TOKEN

docker compose build
docker compose up -d
docker compose logs -f tunnel
```

The `tunnel` container is internal to the `mcp-net` Docker network and
exposes no host port. The MCP container reaches it as `tunnel:3306`.

### Smoke tests

```bash
# Sidecar is healthy and listening
docker compose ps tunnel

# Plain-TCP reachability from the MCP container
docker compose exec mcp nc -vz tunnel 3306        # expect: succeeded

# End-to-end MySQL handshake through the tunnel
docker compose exec mcp node -e \
  "require('./build/db.js').createPool(require('./build/config.js').loadConfig().db).query('SELECT 1').then(r=>console.log(r[0]))"
# expect: [ { '1': 1 } ]

# From your laptop, list tables via mcp-remote (replace with your token + IP)
mcp-remote http://<mini-ip>:8081/mcp --header "Authorization: Bearer $MCP_BEARER_TOKEN"
```

### Failure-mode FAQ

| Symptom                                                | Likely cause                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `tunnel` exits with `403` or `401` in the logs         | Cloudflare Access rejected the service token. Double-check ID/secret and that the Service Auth policy is attached to the Studio app. |
| `connect ECONNREFUSED tunnel:3306`                     | `tunnel` container is not healthy yet. `docker compose logs tunnel`.      |
| `Got packets out of order`                             | Someone forgot `--binary` on websocat. Should never happen here.          |
| `read ETIMEDOUT` after a few minutes                   | The WSS connection lapsed. The supervisor loop will reconnect; the MCP pool will reopen on the next query. |
| `Access denied for user 'guestway_mcp_ro'`             | Tunnel is fine; MySQL credentials are wrong or the user lacks `SELECT`.   |

### Security notes specific to this tunnel

Studio's `/proxy?hostname=&port=` accepts arbitrary host/port query
parameters and proxies raw TCP to *anywhere reachable from the EC2 host*.
Anyone holding a valid Cloudflare Access session against `singlestore.guestway.io`
can pivot through Studio to e.g. internal Redis, S3 metadata, or other
services. The Cloudflare Access policy is the real perimeter here:

- Restrict the Service Auth policy to a specific service token, not "any
  authenticated user."
- Keep `CF_ACCESS_CLIENT_SECRET` out of git, secret managers only.
- Long-term, consider standing up a dedicated Cloudflare Access TCP
  application with `cloudflared access tcp` ingress fixed to
  `tcp://127.0.0.1:3306` on the EC2 side. That removes the pivot risk.

## CA bundle

The SingleStore CA bundle is vendored at
[`src/ca/singlestore-bundle.pem`](src/ca/singlestore-bundle.pem) and loaded
at startup. To refresh it:

```bash
npm run update-ca
git diff src/ca/singlestore-bundle.pem
git add src/ca/singlestore-bundle.pem
```

## Security notes

- **Read-only by design.** `query_table`, `create_table`, and
  `generate_synthetic_data` from the upstream fork have been removed. If
  you ever need them back, they need a separate `MCP_ALLOW_WRITES` flag,
  a separate connection pool with elevated privileges, and a different
  `name` so callers can tell which surface they're talking to.
- **The HTTP transport is authenticated and rate-limited.** The default
  bind is loopback. Refuses to bind to a non-loopback interface unless a
  bearer token is configured.
- **Defense in depth at the database.** This MCP must connect with a role
  that has only `SELECT` (and optionally `EXECUTE` on profile-related
  procedures). Do not rely on the application layer for safety.
- **Logs are stderr-only**, JSON-structured (`pino`), with `Authorization`
  and `password` fields redacted automatically.

## License

MIT. See [`LICENSE`](LICENSE).
