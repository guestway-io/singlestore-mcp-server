# Changelog

All notable changes to this project will be documented in this file. The
format is based on [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to semantic versioning.

## [Unreleased]

### Added
- `tunnel` sidecar: alpine + `websocat` image at [`tunnel/Dockerfile`](tunnel/Dockerfile)
  that bridges the MCP container's TCP MySQL traffic into Studio's
  `wss://${STUDIO_HOST}/proxy?hostname=&port=` endpoint, authenticated with
  Cloudflare Access service-token headers (`CF-Access-Client-Id` /
  `CF-Access-Client-Secret`). Optional `CF_AUTHORIZATION` cookie path for
  short-lived dev runs.
- Supervisor loop in [`tunnel/entrypoint.sh`](tunnel/entrypoint.sh) so the
  single-shot `tcp-listen:` semantics of websocat don't break the MCP's
  pool — websocat is re-execed after each connection closes.
- `docker-compose.yml` now wires `tunnel` and `mcp` on the `mcp-net` network,
  with `mcp` waiting on `tunnel`'s healthcheck (`nc -z 127.0.0.1 3306`).
- TLS knobs in [`src/config.ts`](src/config.ts) and [`src/db.ts`](src/db.ts):
  `SINGLESTORE_TLS`, `SINGLESTORE_TLS_SERVERNAME`,
  `SINGLESTORE_TLS_REJECT_UNAUTHORIZED`. The vendored CA bundle is only
  consulted when TLS is on. Disabling certificate verification logs a loud
  `WARN` at pool creation.
- README "Tunnel" section rewritten with Cloudflare-side setup, bring-up
  steps, smoke tests, failure-mode FAQ, and security notes about Studio's
  `/proxy` allowing arbitrary hostname/port pivots.

### Changed
- Build script now copies `src/ca/` into `build/ca/` so the vendored CA
  ships in the runtime image. Previously the build emitted only `.js`
  files and would have failed at runtime as soon as `SINGLESTORE_TLS=true`
  was set.
- `.env.example` reorganized around the tunnel-first deployment:
  `SINGLESTORE_HOST` defaults to `tunnel`, TLS defaults to off (matches
  the existing `--skip-ssl` mariadb usage in `export-org.nu`).

## [0.1.0] - 2026-05-07

Forked from `madhukarkumar/singlestore-mcp-server` and rebranded to
`@guestway/singlestore-mcp-server`. This is effectively a rewrite.

### Added
- MCP **Streamable HTTP** transport (per current MCP spec) replacing the
  hand-rolled SSE endpoints (`/sse`, `/stream`, `/connect`, `/mcp-sse`).
- Bearer-token auth on the HTTP endpoint, with `timingSafeEqual` comparison.
- Strict CORS allowlist via `MCP_ALLOWED_ORIGINS` (no more `origin: '*'`).
- Optional `Host` header allowlist via `MCP_ALLOWED_HOSTS` for DNS-rebinding
  defense in depth.
- Per-IP rate limiting (`express-rate-limit`) and `helmet` on the HTTP path.
- Real read-only SQL guard backed by `node-sql-parser` (MariaDB dialect),
  with regex backstop for forbidden tokens.
- Vendored SingleStore CA bundle in `src/ca/singlestore-bundle.pem` and a
  `npm run update-ca` script for periodic refresh.
- Structured `pino` logging with secret redaction; all logs go to stderr
  (stdio MCP transport reserves stdout).
- Health endpoint `GET /healthz` and Docker `HEALTHCHECK`.
- Test suite (`node --test`) covering the SQL guard.
- `docker-compose.yml` with an MCP service and a documented (commented)
  TCP-over-WebSocket tunnel sidecar slot for `singlestore.guestway.io`.

### Changed
- `mysql.createConnection` -> `mysql.createPool` (5 connections by default,
  10s connect timeout, `multipleStatements: false`, TLS >= 1.2).
- Server identity is now `guestway-singlestore-mcp` v0.1.0.
- Single 1936-line `src/index.ts` split into `config`, `db`, `logger`,
  `server`, `http`, `sqlGuard`, `tools/*`, and `profile/analyzer`.
- TypeScript: `strict` + `noImplicitAny` + `noUncheckedIndexedAccess`.
- Dockerfile rewritten to Node 22 alpine, multi-stage, runs as `node`,
  `tini` as PID 1, drops hard-coded credential placeholders, uses
  `npm ci --omit=dev`.
- `generate_er_diagram` now derives all relationships from
  `information_schema.KEY_COLUMN_USAGE` instead of hardcoding
  `Documents`/`Document_Embeddings`/etc. from another project.

### Removed
- Tools `query_table`, `create_table`, `generate_synthetic_data`. The MCP
  surface is now read-only; DDL/DML are not exposed to the LLM.
- Hand-rolled SSE transport, the duplicated tool list inside `handleRequest`,
  and the per-message 16 KB chunking workaround.
- Runtime CA bundle download (`fetchCABundle()` from
  `https://portal.singlestore.com/...`). Now vendored.
- Smithery configuration and the Smithery badge from the README.
- `debug_headers.sh`, `test_sse_connection.sh`, `run_with_inspector.sh`,
  `MCP_INSPECTOR.md` - all band-aids for bugs we deleted.

### Security
- Resolves [GHSA-8r9q-7v3j-jr4g] (MCP SDK ReDoS) by upgrading to
  `@modelcontextprotocol/sdk@^1.29`.
- Resolves [GHSA-w48q-cv73-mx4w] (MCP SDK DNS rebinding default off).
- Resolves [GHSA-w7fw-mjwx-w883] / [GHSA-6rw7-vpxm-498p] (qs DoS) and the
  associated `path-to-regexp` issues by moving to `express@^5`.
- Removes the unauthenticated arbitrary-SQL endpoint that was previously
  bound to `0.0.0.0`.
- `npm audit` reports zero vulnerabilities at the time of the rewrite.
