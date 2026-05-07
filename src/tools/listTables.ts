import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../db.js';
import { jsonResult } from './shared.js';

export function registerListTables(server: McpServer): void {
  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description: 'List all tables in the configured SingleStore database.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const [rows] = await getPool().query<RowDataPacket[]>(
        'SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
      );
      return jsonResult(rows.map((r) => r['table_name']));
    },
  );
}
