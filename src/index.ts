#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { closePool, createPool } from './db.js';
import { buildMcpServer } from './server.js';
import { startHttpServer, type HttpServerHandle } from './http.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  createPool(cfg.db);

  let httpHandle: HttpServerHandle | undefined;
  if (cfg.http.enabled) {
    httpHandle = await startHttpServer(cfg);
  }

  const stdioServer = buildMcpServer();
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  logger.info({ httpEnabled: cfg.http.enabled }, 'guestway-singlestore-mcp ready (stdio)');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    try {
      await stdioServer.close();
    } catch (err) {
      logger.warn({ err }, 'error closing stdio server');
    }
    if (httpHandle) {
      try {
        await httpHandle.close();
      } catch (err) {
        logger.warn({ err }, 'error closing http server');
      }
    }
    try {
      await closePool();
    } catch (err) {
      logger.warn({ err }, 'error closing pool');
    }
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
