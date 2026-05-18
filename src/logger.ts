import pino from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = pino({
  level,
  base: { service: 'guestway-singlestore-mcp' },
  redact: {
    paths: [
      'password',
      'token',
      'req.headers.cookie',
      'config.db.password',
      '*.password',
      '*.token',
    ],
    remove: true,
  },
  // The MCP stdio transport reserves stdout for protocol traffic.
  // All logs must go to stderr.
}, pino.destination(2));
