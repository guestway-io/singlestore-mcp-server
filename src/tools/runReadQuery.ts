import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../db.js';
import { assertReadOnlySelect } from '../sqlGuard.js';
import { jsonResult } from './shared.js';

const MAX_ROWS = 1000;

export function registerRunReadQuery(server: McpServer): void {
  server.registerTool(
    'run_read_query',
    {
      title: 'Run read-only query',
      description:
        'Execute a single SELECT (or pure-SELECT WITH/CTE) statement and return up to ' +
        `${MAX_ROWS} rows. DDL, DML, multiple statements, and SET are rejected.`,
      inputSchema: {
        query: z.string().min(1).max(50_000).describe('A single SELECT statement.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ query }) => {
      const guard = assertReadOnlySelect(query);
      if (!guard.ok) {
        throw new Error(`Query rejected by read-only guard: ${guard.reason}`);
      }

      const [rows] = await getPool().query<RowDataPacket[]>(query);
      const truncated = rows.length > MAX_ROWS;
      const trimmed = truncated ? rows.slice(0, MAX_ROWS) : rows;

      return jsonResult({
        row_count: trimmed.length,
        truncated,
        ...(truncated ? { truncated_at: MAX_ROWS } : {}),
        rows: trimmed,
      });
    },
  );
}
