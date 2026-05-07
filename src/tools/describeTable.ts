import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RowDataPacket } from 'mysql2';
import { assertSafeIdentifier, getPool } from '../db.js';
import { jsonResult } from './shared.js';

export function registerDescribeTable(server: McpServer): void {
  server.registerTool(
    'describe_table',
    {
      title: 'Describe table',
      description:
        'Return the schema, row count, and a 5-row sample for the given table. Read-only.',
      inputSchema: {
        table: z.string().min(1).max(64).describe('Table name (alphanumeric/underscore only).'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ table }) => {
      const safe = assertSafeIdentifier(table, 'table name');
      const pool = getPool();

      const [columns] = await pool.query<RowDataPacket[]>('DESCRIBE ??', [safe]);
      const [stats] = await pool.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total_rows FROM ??',
        [safe],
      );
      const [sample] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM ?? LIMIT 5',
        [safe],
      );

      return jsonResult({
        table: safe,
        schema: columns,
        statistics: stats[0] ?? { total_rows: 0 },
        sample_data: sample,
      });
    },
  );
}
