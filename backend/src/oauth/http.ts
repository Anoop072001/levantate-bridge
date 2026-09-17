import type { IncomingMessage, ServerResponse } from "node:http";
import { registerAgent } from "../agents/register.js";
import { acceptedResource, publicBaseUrl } from "./origin.js";
import {
  hmacConsent,
  pkceS256,
  randomToken,
  signAccessToken,
} from "./tokens.js";
import {
  consumeCode,
  consumeRefresh,
  getClient,
  saveClient,
  saveCode,
  saveRefresh,
  codeExpiry,
  type RegisteredClient,
} from "./state.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
};

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...CORS, ...extra });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...CORS });
  res.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function asMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["mcp", "offline_access"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

function asResource(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp", "offline_access"],
  };
}

async function resolveClient(clientId: string): Promise<RegisteredClient | undefined> {
  const existing = getClient(clientId);
  if (existing) return existing;
  if (!clientId.startsWith("https://")) return undefined;
  try {
    const res = await fetch(clientId, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return undefined;
    const doc = (await res.json()) as {
      client_id?: string;
      client_name?: string;
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
    };
    if (doc.client_id !== clientId) return undefined;
    if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) return undefined;
    const client: RegisteredClient = {
      clientId,
      clientName: doc.client_name?.trim() || "MCP client",
      redirectUris: doc.redirect_uris,
      tokenEndpointAuthMethod: "none",
    };
    saveClient(client);
    return client;
  } catch {
    return undefined;
  }
}

function redirectWith(res: ServerResponse, redirectUri: string, params: Record<string, string>): void {
  const dest = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  res.writeHead(302, { location: dest.toString(), ...CORS });
  res.end();
}

function consentHtml(input: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  issuer: string;
  token: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect to Levantate Bridge</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0b0c; color: #f4f4f5;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { width: min(440px, 92vw); background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 28px; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    p { color: #a1a1aa; font-size: 0.95rem; line-height: 1.45; }
    label { display: block; font-size: 0.75rem; color: #a1a1aa; margin: 16px 0 6px; }
    input { width: 100%; box-sizing: border-box; border-radius: 10px; border: 1px solid #3f3f46;
      background: #09090b; color: #fafafa; padding: 10px 12px; }
    .row { display: flex; gap: 10px; margin-top: 20px; }
    button { flex: 1; border: 0; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-weight: 600; }
    .allow { background: #fafafa; color: #09090b; }
    .deny { background: #27272a; color: #e4e4e7; }
  </style>
</head>
<body>
  <form class="card" method="post" action="/oauth/authorize">
    <h1>Connect ${escapeHtml(input.clientName)}</h1>
    <p>This AI will get its own Circle wallet on Arc testnet to post tasks and pay workers in USDC. Approve only if you trust this client.</p>
    <label for="name">Agent name</label>
    <input id="name" name="name" value="${escapeHtml(input.clientName)}" maxlength="64" />
    <input type="hidden" name="client_id" value="${escapeHtml(input.clientId)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}" />
    <input type="hidden" name="state" value="${escapeHtml(input.state)}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(input.codeChallenge)}" />
    <input type="hidden" name="resource" value="${escapeHtml(input.resource)}" />
    <input type="hidden" name="scope" value="${escapeHtml(input.scope)}" />
    <input type="hidden" name="issuer" value="${escapeHtml(input.issuer)}" />
    <input type="hidden" name="consent" value="${escapeHtml(input.token)}" />
    <div class="row">
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="allow" type="submit" name="decision" value="allow">Create wallet and allow</button>
    </div>
  </form>
</body>
</html>`;
}

function consentPayload(fields: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  resource: string;
}): string {
  return [
    fields.client_id,
    fields.redirect_uri,
    fields.state,
    fields.code_challenge,
    fields.resource,
  ].join("\n");
}

export async function handleOAuthHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const isWellKnown =
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp" ||
    path === "/.well-known/oauth-authorization-server" ||
    path === "/.well-known/oauth-authorization-server/mcp" ||
    path === "/.well-known/openid-configuration";
  const isOauth =
    path === "/oauth/register" || path === "/oauth/authorize" || path === "/oauth/token";
  if (!isWellKnown && !isOauth) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  const base = publicBaseUrl(req);

  const isGetMeta = req.method === "GET" || req.method === "HEAD";
  if (isGetMeta && path.startsWith("/.well-known/oauth-protected-resource")) {
    json(res, 200, asResource(base));
    return true;
  }
  if (
    isGetMeta &&
    (path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/oauth-authorization-server/mcp" ||
      path === "/.well-known/openid-configuration")
  ) {
    json(res, 200, asMetadata(base));
    return true;
  }

  if (path === "/oauth/register" && req.method === "POST") {
    const raw = await readRaw(req);
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json(res, 400, { error: "invalid_client_metadata" });
      return true;
    }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string" && u.length > 0)
      : [];
    if (redirectUris.length === 0) {
      json(res, 400, { error: "invalid_redirect_uri" });
      return true;
    }
    const clientId = randomToken("dcr_");
    const clientName = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : "MCP client";
    saveClient({
      clientId,
      clientName,
      redirectUris,
      tokenEndpointAuthMethod: "none",
    });
    json(res, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    return true;
  }

  if (path === "/oauth/authorize" && req.method === "GET") {
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    const method = (url.searchParams.get("code_challenge_method") ?? "").toUpperCase();
    const responseType = url.searchParams.get("response_type") ?? "";
    const resource = acceptedResource(url.searchParams.get("resource"), base);
    const scope = url.searchParams.get("scope") ?? "mcp offline_access";

    if (responseType !== "code" || method !== "S256" || !challenge || !clientId || !redirectUri) {
      html(res, 400, "<p>Invalid authorization request (need response_type=code and PKCE S256).</p>");
      return true;
    }
    const client = await resolveClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      html(res, 400, "<p>Unknown OAuth client or redirect_uri is not registered.</p>");
      return true;
    }
    if (!resource) {
      html(res, 400, "<p>Invalid resource. This server only issues tokens for /mcp.</p>");
      return true;
    }
    const token = hmacConsent(consentPayload({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      resource,
    }));
    html(
      res,
      200,
      consentHtml({
        clientName: client.clientName,
        clientId,
        redirectUri,
        state,
        codeChallenge: challenge,
        resource,
        scope,
        issuer: base,
        token,
      }),
    );
    return true;
  }

  if (path === "/oauth/authorize" && req.method === "POST") {
    const raw = await readRaw(req);
    const form = new URLSearchParams(raw);
    const clientId = form.get("client_id") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const state = form.get("state") ?? "";
    const challenge = form.get("code_challenge") ?? "";
    const resource = form.get("resource") ?? `${base}/mcp`;
    const decision = form.get("decision") ?? "deny";
    const name = form.get("name")?.trim() || undefined;
    const expected = hmacConsent(
      consentPayload({
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        resource,
      }),
    );
    if (form.get("consent") !== expected) {
      html(res, 400, "<p>Consent expired. Start sign-in again from Claude or ChatGPT.</p>");
      return true;
    }
    const client = await resolveClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      html(res, 400, "<p>Unknown OAuth client.</p>");
      return true;
    }
    if (decision !== "allow") {
      redirectWith(res, redirectUri, {
        error: "access_denied",
        state,
        iss: base,
      });
      return true;
    }
    try {
      const created = await registerAgent(name || client.clientName);
      const code = randomToken("oc_");
      saveCode(code, {
        clientId,
        redirectUri,
        codeChallenge: challenge,
        resource,
        agentId: created.agent.id,
        expiresAt: codeExpiry(),
      });
      redirectWith(res, redirectUri, { code, state, iss: base });
    } catch (err) {
      html(
        res,
        500,
        `<p>Could not create a Circle wallet: ${escapeHtml(err instanceof Error ? err.message : "unknown error")}</p>`,
      );
    }
    return true;
  }

  if (path === "/oauth/token" && req.method === "POST") {
    const raw = await readRaw(req);
    const form = new URLSearchParams(raw.startsWith("{") ? "" : raw);
    let body: Record<string, string> = {};
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") body[k] = v;
      } catch {
        json(res, 400, { error: "invalid_request" });
        return true;
      }
    } else {
      body = Object.fromEntries(form.entries());
    }
    const grant = body.grant_type;
    const clientId = body.client_id ?? "";

    if (grant === "authorization_code") {
      const code = body.code ?? "";
      const verifier = body.code_verifier ?? "";
      const redirectUri = body.redirect_uri ?? "";
      const record = consumeCode(code);
      if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      if (pkceS256(verifier) !== record.codeChallenge) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      const access = signAccessToken({
        iss: base,
        aud: record.resource,
        sub: record.agentId,
        scope: "mcp offline_access",
      });
      const refreshToken = randomToken("rt_");
      saveRefresh(refreshToken, {
        agentId: record.agentId,
        clientId,
        resource: record.resource,
      });
      json(res, 200, {
        access_token: access,
        token_type: "Bearer",
        expires_in: 7 * 24 * 3600,
        refresh_token: refreshToken,
        scope: "mcp offline_access",
      });
      return true;
    }

    if (grant === "refresh_token") {
      const record = consumeRefresh(body.refresh_token ?? "");
      if (!record || record.clientId !== clientId) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      const access = signAccessToken({
        iss: base,
        aud: record.resource,
        sub: record.agentId,
        scope: "mcp offline_access",
      });
      const next = randomToken("rt_");
      saveRefresh(next, record);
      json(res, 200, {
        access_token: access,
        token_type: "Bearer",
        expires_in: 7 * 24 * 3600,
        refresh_token: next,
        scope: "mcp offline_access",
      });
      return true;
    }

    json(res, 400, { error: "unsupported_grant_type" });
    return true;
  }

  return false;
}

export function mcpUnauthorizedHeaders(req: IncomingMessage): Record<string, string> {
  const base = publicBaseUrl(req);
  return {
    ...CORS,
    "www-authenticate": `Bearer realm="Levantate Bridge", resource_metadata="${base}/.well-known/oauth-protected-resource", scope="mcp"`,
  };
}
