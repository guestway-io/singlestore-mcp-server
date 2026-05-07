import mysql from 'mysql2/promise';
import type { AppConfig, DbTlsConfig } from './config.js';
import { logger } from './logger.js';

let pool: mysql.Pool | null = null;

function buildSslOption(tls: DbTlsConfig): mysql.PoolOptions['ssl'] {
  if (!tls.enabled) return undefined;
  if (!tls.rejectUnauthorized) {
    logger.warn(
      'SINGLESTORE_TLS_REJECT_UNAUTHORIZED=false: SingleStore certificate is NOT being verified. ' +
        'Use only for self-signed dev clusters; never in production.',
    );
  }
  const ssl: Record<string, unknown> = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: tls.rejectUnauthorized,
  };
  if (tls.caBundle) ssl['ca'] = tls.caBundle;
  if (tls.servername) ssl['servername'] = tls.servername;
  return ssl as mysql.PoolOptions['ssl'];
}

export function createPool(cfg: AppConfig['db']): mysql.Pool {
  if (pool) return pool;
  const ssl = buildSslOption(cfg.tls);
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: cfg.connectionLimit,
    connectTimeout: cfg.connectTimeoutMs,
    multipleStatements: false,
    ssl,
  });
  logger.info(
    {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      poolSize: cfg.connectionLimit,
      tls: cfg.tls.enabled,
      tlsServername: cfg.tls.servername ?? null,
    },
    'mysql pool created',
  );
  return pool;
}

export function getPool(): mysql.Pool {
  if (!pool) throw new Error('Database pool has not been initialized');
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
  logger.info('mysql pool closed');
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;

export function assertSafeIdentifier(name: string, kind = 'identifier'): string {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    throw new Error(`Invalid ${kind}: ${JSON.stringify(name)}`);
  }
  return name;
}
