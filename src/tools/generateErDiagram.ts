import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RowDataPacket } from 'mysql2';
import { assertSafeIdentifier, getPool } from '../db.js';
import { textResult } from './shared.js';

interface TableRow extends RowDataPacket {
  TABLE_NAME: string;
}

interface ColumnRow extends RowDataPacket {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: string | null;
  Extra: string;
}

interface FkRow extends RowDataPacket {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
}

export function registerGenerateErDiagram(server: McpServer): void {
  server.registerTool(
    'generate_er_diagram',
    {
      title: 'Generate ER diagram',
      description:
        'Generate a Mermaid `erDiagram` from `information_schema` (tables, columns, foreign keys).',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const pool = getPool();

      const [tables] = await pool.query<TableRow[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      );

      const [fks] = await pool.query<FkRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
      );

      const lines: string[] = ['erDiagram'];

      for (const table of tables) {
        const tableName = assertSafeIdentifier(table.TABLE_NAME, 'table name');
        const [columns] = await pool.query<ColumnRow[]>('DESCRIBE ??', [tableName]);
        lines.push(`    ${tableName} {`);
        for (const col of columns) {
          const fieldType = String(col.Type).split('(')[0]?.replace(/\s+/g, '_') ?? 'unknown';
          const colName = String(col.Field).replace(/[^A-Za-z0-9_]/g, '_');
          const flags: string[] = [];
          if (col.Key === 'PRI') flags.push('PK');
          if (col.Key === 'MUL') flags.push('FK');
          lines.push(`        ${fieldType} ${colName}${flags.length ? ' ' + flags.join(' ') : ''}`);
        }
        lines.push('    }');
      }

      for (const fk of fks) {
        const child = String(fk.TABLE_NAME).replace(/[^A-Za-z0-9_]/g, '_');
        const parent = String(fk.REFERENCED_TABLE_NAME).replace(/[^A-Za-z0-9_]/g, '_');
        const label = String(fk.CONSTRAINT_NAME).replace(/"/g, "'");
        lines.push(`    ${parent} ||--o{ ${child} : "${label}"`);
      }

      return textResult(lines.join('\n'));
    },
  );
}
