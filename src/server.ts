import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SERVER_NAME, SERVER_VERSION } from './config.js';
import { registerAllTools } from './tools/index.js';

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        'Read-only MCP server for SingleStore. Tools list/describe tables, run SELECT-only queries, ' +
        'profile a SELECT, and emit a Mermaid ER diagram from information_schema.',
    },
  );
  registerAllTools(server);
  return server;
}
