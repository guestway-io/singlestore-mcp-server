import { randomUUID } from 'node:crypto';
import http from 'node:http';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AppConfig } from './config.js';
import { logger } from './logger.js';
import { buildMcpServer } from './server.js';

const MCP_PATH = '/mcp';

interface ActiveSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

export interface HttpServerHandle {
  close(): Promise<void>;
  port: number;
}

export async function startHttpServer(cfg: AppConfig): Promise<HttpServerHandle> {
  const sessions = new Map<string, ActiveSession>();

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));

  const corsOptions: cors.CorsOptions = {
    origin: cfg.http.allowedOrigins.length > 0 ? cfg.http.allowedOrigins : false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Mcp-Session-Id', 'MCP-Protocol-Version', 'Last-Event-ID'],
    exposedHeaders: ['Mcp-Session-Id'],
    credentials: false,
    maxAge: 600,
  };
  app.use(cors(corsOptions));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: cfg.http.rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'rate limit exceeded' },
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', sessions: sessions.size });
  });

  if (cfg.http.allowedHosts.length > 0) {
    app.use((req, res, next) => {
      const host = req.headers.host;
      if (!host || !cfg.http.allowedHosts.includes(host)) {
        logger.warn({ host, ip: req.ip }, 'rejected request: host not allowed');
        return res.status(403).json({ error: 'host not allowed' });
      }
      next();
    });
  }

  app.use(MCP_PATH, express.json({ limit: cfg.http.bodyLimit }));

  const handler = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

      let active: ActiveSession | undefined;
      if (sessionId && sessions.has(sessionId)) {
        active = sessions.get(sessionId);
      } else if (req.method === 'POST' && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server });
            logger.info({ sessionId: id, count: sessions.size }, 'mcp session opened');
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
            logger.info({ sessionId: id, count: sessions.size }, 'mcp session closed');
          },
        });
        const server = buildMcpServer();
        await server.connect(transport);
        active = { transport, server };
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32_000, message: 'Bad Request: invalid or missing Mcp-Session-Id' },
          id: null,
        });
        return;
      }

      if (!active) {
        res.status(500).json({ error: 'Internal Server Error' });
        return;
      }

      await active.transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, 'mcp http handler error');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32_603, message: 'Internal error' },
          id: null,
        });
      }
    }
  };

  app.post(MCP_PATH, handler);
  app.get(MCP_PATH, handler);
  app.delete(MCP_PATH, handler);

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(cfg.http.port, cfg.http.host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  logger.info(
    {
      host: cfg.http.host,
      port: cfg.http.port,
      allowedOrigins: cfg.http.allowedOrigins,
      allowedHosts: cfg.http.allowedHosts,
    },
    'mcp Streamable HTTP transport listening (no auth)',
  );

  const isLoopback = cfg.http.host === '127.0.0.1' || cfg.http.host === 'localhost' || cfg.http.host === '::1';
  if (!isLoopback) {
    logger.warn(
      { host: cfg.http.host, port: cfg.http.port },
      'MCP HTTP endpoint is bound to a non-loopback interface WITHOUT authentication. ' +
        'Anyone able to reach this host:port can run read-only SQL via the MCP. ' +
        'The Cloudflare Access tunnel does NOT cover this hop.',
    );
  }

  return {
    port: cfg.http.port,
    async close() {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      for (const [, session] of sessions) {
        try {
          await session.transport.close();
        } catch (err) {
          logger.warn({ err }, 'error closing session transport');
        }
      }
      sessions.clear();
    },
  };
}
