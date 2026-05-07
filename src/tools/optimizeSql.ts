import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../db.js';
import { assertReadOnlySelect } from '../sqlGuard.js';
import { analyzeProfileData } from '../profile/analyzer.js';
import { jsonResult } from './shared.js';

export function registerOptimizeSql(server: McpServer): void {
  server.registerTool(
    'optimize_sql',
    {
      title: 'Optimize SQL',
      description:
        'PROFILE a SELECT statement and return performance summary, bottlenecks, and human recommendations. Read-only: writes/DDL are rejected.',
      inputSchema: {
        query: z.string().min(1).max(50_000).describe('A single SELECT statement to profile.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ query }) => {
      const guard = assertReadOnlySelect(query);
      if (!guard.ok) {
        throw new Error(`Query rejected by read-only guard: ${guard.reason}`);
      }

      const pool = getPool();
      const conn = await pool.getConnection();
      try {
        await conn.query('SET SESSION profile_for_debug = ON');
        await conn.query(`PROFILE ${query}`);
        const [profileResult] = await conn.query<RowDataPacket[]>('SHOW PROFILE JSON');
        const recommendations = analyzeProfileData(profileResult[0]);
        return jsonResult({
          original_query: query,
          profile_summary: recommendations.summary,
          recommendations: recommendations.suggestions,
          optimized_query: recommendations.optimizedQuery ?? query,
        });
      } finally {
        try {
          await conn.query('SET SESSION profile_for_debug = OFF');
        } catch {
          // best-effort reset
        }
        conn.release();
      }
    },
  );
}
