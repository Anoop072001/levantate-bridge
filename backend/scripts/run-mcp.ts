/**
 * MCP server for local clients (Claude Desktop, Cursor).
 *
 * Requires LEVANTATE_AGENT_API_KEY from POST /api/agents/register.
 *
 * Claude Desktop (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "levantate-bridge": {
 *       "command": "npm",
 *       "args": ["run", "mcp", "--prefix", "/absolute/path/to/levantate-bridge/backend"],
 *       "env": { "LEVANTATE_AGENT_API_KEY": "lb_..." }
 *     }
 *   }
 * }
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { actorFromAgent, resolveAgentFromApiKey } from "../src/auth/agent.js";
import { loadRootEnv } from "../src/env.js";
import { registerLevantateMcpTools } from "../src/mcp/register.js";

loadRootEnv();

const apiKey = process.env.LEVANTATE_AGENT_API_KEY?.trim();
if (!apiKey) {
  console.error("LEVANTATE_AGENT_API_KEY is required. Register at POST /api/agents/register.");
  process.exit(1);
}

const agent = await resolveAgentFromApiKey(apiKey);
if (!agent) {
  console.error("LEVANTATE_AGENT_API_KEY is not a registered agent.");
  process.exit(1);
}

const actor = actorFromAgent(agent);

serveStdio(() => {
  const server = new McpServer(
    { name: "levantate-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerLevantateMcpTools(server, actor);
  return server;
});
