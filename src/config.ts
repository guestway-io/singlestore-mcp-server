import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const SERVER_NAME = 'guestway-singlestore-mcp';
export const SERVER_VERSION = '0.1.0';

export interface DbTlsConfig {
  enabled: boolean;
  caBundle: string | undefined;
  servername: string | undefined;
  rejectUnauthorized: boolean;
}

export interface AppConfig {
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
    connectTimeoutMs: number;
    tls: DbTlsConfig;
  };
  http: {
    enabled: boolean;
    host: string;
    port: number;
    bearerToken: string | undefined;
    allowedOrigins: string[];
    allowedHosts: string[];
    rateLimitPerMinute: number;
    bodyLimit: string;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function loadCaBundle(): string {
  const bundlePath = resolve(__dirname, 'ca', 'singlestore-bundle.pem');
  let pem: string;
  try {
    pem = readFileSync(bundlePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to read vendored SingleStore CA bundle from ${bundlePath}: ${reason}. ` +
        'Run `npm run update-ca` to refresh it.',
      { cause: err },
    );
  }
  if (!pem.includes('BEGIN CERTIFICATE')) {
    throw new Error(
      `Invalid SingleStore CA bundle at ${bundlePath}: missing PEM markers. ` +
        'Run `npm run update-ca` to refresh it.',
    );
  }
  return pem;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function loadTlsConfig(): DbTlsConfig {
  const enabled = parseBool(process.env.SINGLESTORE_TLS, false);
  if (!enabled) {
    return { enabled: false, caBundle: undefined, servername: undefined, rejectUnauthorized: true };
  }
  return {
    enabled: true,
    caBundle: loadCaBundle(),
    servername: process.env.SINGLESTORE_TLS_SERVERNAME?.trim() || undefined,
    rejectUnauthorized: parseBool(process.env.SINGLESTORE_TLS_REJECT_UNAUTHORIZED, true),
  };
}

export function loadConfig(): AppConfig {
  const httpEnabled = (process.env.MCP_HTTP_ENABLED ?? process.env.SSE_ENABLED ?? 'false') === 'true';
  const httpHost = process.env.MCP_HTTP_HOST ?? '127.0.0.1';
  const bearerToken = process.env.MCP_BEARER_TOKEN?.trim() || undefined;

  if (httpEnabled && !bearerToken && httpHost !== '127.0.0.1' && httpHost !== 'localhost' && httpHost !== '::1') {
    throw new Error(
      'Refusing to bind MCP HTTP transport to a non-loopback host without MCP_BEARER_TOKEN. ' +
        'Either set MCP_BEARER_TOKEN, set MCP_HTTP_HOST=127.0.0.1, or disable MCP_HTTP_ENABLED.',
    );
  }

  return {
    db: {
      host: requireEnv('SINGLESTORE_HOST'),
      port: parsePort(process.env.SINGLESTORE_PORT, 3306),
      user: requireEnv('SINGLESTORE_USER'),
      password: requireEnv('SINGLESTORE_PASSWORD'),
      database: requireEnv('SINGLESTORE_DATABASE'),
      connectionLimit: parsePort(process.env.SINGLESTORE_POOL_LIMIT, 5),
      connectTimeoutMs: parsePort(process.env.SINGLESTORE_CONNECT_TIMEOUT_MS, 10_000),
      tls: loadTlsConfig(),
    },
    http: {
      enabled: httpEnabled,
      host: httpHost,
      port: parsePort(process.env.MCP_HTTP_PORT ?? process.env.MCP_SSE_PORT ?? process.env.SSE_PORT, 8081),
      bearerToken,
      allowedOrigins: parseList(process.env.MCP_ALLOWED_ORIGINS),
      allowedHosts: parseList(process.env.MCP_ALLOWED_HOSTS),
      rateLimitPerMinute: parsePort(process.env.MCP_RATE_LIMIT_PER_MIN, 120),
      bodyLimit: process.env.MCP_BODY_LIMIT ?? '256kb',
    },
  };
}
