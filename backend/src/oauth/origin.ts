import type { IncomingMessage } from "node:http";

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/** Public HTTPS origin as Claude/ChatGPT will call it (ngrok, Heroku, or PUBLIC_BACKEND_URL). */
export function publicBaseUrl(req: IncomingMessage): string {
  const fromEnv = process.env.PUBLIC_BACKEND_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const proto =
    header(req, "x-forwarded-proto")?.split(",")[0]?.trim() ||
    (header(req, "x-forwarded-ssl") === "on" ? "https" : undefined);
  const host =
    header(req, "x-forwarded-host")?.split(",")[0]?.trim() || header(req, "host") || "localhost:3001";
  const scheme = proto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${scheme}://${host}`;
}

export function mcpResourceUrl(req: IncomingMessage): string {
  return `${publicBaseUrl(req)}/mcp`;
}

export function acceptedResource(value: string | null, base: string): string | undefined {
  const mcp = `${base}/mcp`;
  if (!value) return mcp;
  const normalized = value.replace(/\/$/, "");
  if (normalized === base || normalized === mcp) return mcp;
  return undefined;
}
