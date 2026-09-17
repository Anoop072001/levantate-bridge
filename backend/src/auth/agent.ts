import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { findAgentByApiKeyHash, findAgentById, type AgentRecord } from "../store.js";
import { mcpResourceUrl, publicBaseUrl } from "../oauth/origin.js";
import { verifyAccessToken } from "../oauth/tokens.js";

export type { AgentRecord };

export function generateAgentApiKey(): string {
  return `lb_${randomBytes(32).toString("hex")}`;
}

export function hashAgentApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function readProvidedAgentKey(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const header = req.headers["x-operator-key"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return undefined;
}

export async function resolveAgentFromApiKey(apiKey: string): Promise<AgentRecord | undefined> {
  if (apiKey.startsWith("eyJ") && apiKey.split(".").length === 3) {
    return undefined;
  }
  const expectedHash = hashAgentApiKey(apiKey);
  const agent = await findAgentByApiKeyHash(expectedHash);
  if (!agent) return undefined;
  const a = Buffer.from(expectedHash);
  const b = Buffer.from(hashAgentApiKey(apiKey));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return agent;
}

export async function resolveAgentFromBearer(
  token: string,
  req: IncomingMessage,
): Promise<AgentRecord | undefined> {
  const jwt = verifyAccessToken(token, publicBaseUrl(req), mcpResourceUrl(req));
  if (jwt) return findAgentById(jwt.sub);
  return resolveAgentFromApiKey(token);
}

/** Returns the agent or writes a JSON error. */
export async function requireAgentAuth(
  req: IncomingMessage,
  json: (status: number, payload: unknown) => void,
): Promise<AgentRecord | null> {
  const provided = readProvidedAgentKey(req);
  if (!provided) {
    json(401, { error: "Agent authentication required" });
    return null;
  }
  const agent = await resolveAgentFromBearer(provided, req);
  if (!agent) {
    json(403, { error: "Invalid agent credentials" });
    return null;
  }
  return agent;
}

export function actorFromAgent(agent: AgentRecord): { walletId: string; address: `0x${string}` } {
  return {
    walletId: agent.circleWalletId,
    address: agent.address as `0x${string}`,
  };
}
