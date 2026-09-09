/**
 * MCP server for external AI clients (Claude Desktop, Cursor, etc.).
 *
 * Add to Claude Desktop config (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "levantate-bridge": {
 *       "command": "npm",
 *       "args": ["run", "mcp", "--prefix", "/absolute/path/to/levantate-bridge/backend"]
 *     }
 *   }
 * }
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadRootEnv } from "../src/env.js";
import { registerLevantateMcpTools } from "../src/mcp/register.js";

loadRootEnv();

serveStdio(() => {
  const server = new McpServer(
    { name: "levantate-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerLevantateMcpTools(server);
  return server;
});
