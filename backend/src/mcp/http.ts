import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { actorFromAgent, readProvidedAgentKey, resolveAgentFromBearer } from "../auth/agent.js";
import { mcpUnauthorizedHeaders } from "../oauth/http.js";
import { registerLevantateMcpTools } from "./register.js";

const MCP_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, x-operator-key, mcp-session-id, mcp-protocol-version",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

export async function handleMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== "/mcp") return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, MCP_CORS);
    res.end();
    return true;
  }

  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    res.writeHead(405, { "content-type": "application/json", ...MCP_CORS });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  const provided = readProvidedAgentKey(req);
  const agent = provided ? await resolveAgentFromBearer(provided, req) : undefined;
  if (!agent) {
    res.writeHead(401, { "content-type": "application/json", ...mcpUnauthorizedHeaders(req) });
    res.end(JSON.stringify({ error: "Agent authentication required" }));
    return true;
  }

  const server = new McpServer(
    { name: "levantate-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerLevantateMcpTools(server, actorFromAgent(agent));

  // Public HTTPS: do not compose localhostHostValidation / localhostOriginValidation.
  // Those SDK helpers would 403 Claude/ChatGPT connectors hitting the deployed API.
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
  return true;
}
