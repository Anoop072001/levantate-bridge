import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function secret(): Buffer {
  const raw =
    process.env.MCP_OAUTH_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "levantate-dev-oauth";
  return createHash("sha256").update(raw, "utf8").digest();
}

export interface AccessClaims {
  iss: string;
  aud: string;
  sub: string;
  scope: string;
  iat: number;
  exp: number;
}

export function signAccessToken(claims: Omit<AccessClaims, "iat" | "exp">, ttlSec = 7 * 24 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessClaims = { ...claims, iat: now, exp: now + ttlSec };
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyAccessToken(token: string, expectedIss: string, expectedAud: string): AccessClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [header, body, sig] = parts;
  const expected = b64url(createHmac("sha256", secret()).update(`${header}.${body}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== expectedIss || claims.aud !== expectedAud) return undefined;
    if (claims.exp < now) return undefined;
    if (!claims.sub) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

export function randomToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString("hex")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function hmacConsent(payload: string): string {
  return createHmac("sha256", secret()).update(payload, "utf8").digest("hex");
}
