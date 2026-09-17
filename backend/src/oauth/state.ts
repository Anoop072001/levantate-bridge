import { sha256Hex } from "./tokens.js";

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: "none" | "client_secret_post";
  clientSecretHash?: string;
}

export interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  agentId: string;
  expiresAt: number;
}

export interface RefreshRecord {
  agentId: string;
  clientId: string;
  resource: string;
  expiresAt: number;
}

const clients = new Map<string, RegisteredClient>();
const codes = new Map<string, AuthCode>();
const refresh = new Map<string, RefreshRecord>();

const CODE_TTL_MS = 10 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;

export function saveClient(client: RegisteredClient): void {
  clients.set(client.clientId, client);
}

export function getClient(clientId: string): RegisteredClient | undefined {
  return clients.get(clientId);
}

export function saveCode(code: string, record: AuthCode): void {
  codes.set(code, record);
}

export function consumeCode(code: string): AuthCode | undefined {
  const record = codes.get(code);
  codes.delete(code);
  if (!record || record.expiresAt < Date.now()) return undefined;
  return record;
}

export function saveRefresh(token: string, record: Omit<RefreshRecord, "expiresAt">): void {
  refresh.set(sha256Hex(token), { ...record, expiresAt: Date.now() + REFRESH_TTL_MS });
}

export function consumeRefresh(token: string): RefreshRecord | undefined {
  const key = sha256Hex(token);
  const record = refresh.get(key);
  refresh.delete(key);
  if (!record || record.expiresAt < Date.now()) return undefined;
  return record;
}

export function codeExpiry(): number {
  return Date.now() + CODE_TTL_MS;
}
