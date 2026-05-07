import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListTables } from './listTables.js';
import { registerDescribeTable } from './describeTable.js';
import { registerRunReadQuery } from './runReadQuery.js';
import { registerGenerateErDiagram } from './generateErDiagram.js';
import { registerOptimizeSql } from './optimizeSql.js';

export function registerAllTools(server: McpServer): void {
  registerListTables(server);
  registerDescribeTable(server);
  registerRunReadQuery(server);
  registerGenerateErDiagram(server);
  registerOptimizeSql(server);
}
