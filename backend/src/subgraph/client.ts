import { requireEnv } from "../env.js";

const DEFAULT_SUBGRAPH_ID = "Fnr7E8tC1HbD1bvdAsTXMwe5R5kZdx98pH1bhmcWWGeL";
const GATEWAY_SUBGRAPH_PATH = /\/api\/subgraphs\/id\//;

interface SubgraphEndpoint {
  url: string;
  apiKey?: string;
}

/** Gateway queries use Bearer auth; legacy Studio URLs are used as-is. */
function resolveSubgraphEndpoint(): SubgraphEndpoint {
  const explicit = process.env.SUBGRAPH_QUERY_URL?.trim();
  if (explicit && !explicit.includes("[api-key]")) {
    const apiKey = process.env.GRAPH_QUERY_API_KEY?.trim();
    if (GATEWAY_SUBGRAPH_PATH.test(explicit)) {
      return { url: explicit, apiKey: apiKey || undefined };
    }
    return { url: explicit };
  }

  const apiKey = requireEnv("GRAPH_QUERY_API_KEY");
  const subgraphId = process.env.GRAPH_SUBGRAPH_ID?.trim() || DEFAULT_SUBGRAPH_ID;
  return {
    url: `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`,
    apiKey,
  };
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const RETRYABLE_STATUSES = new Set([429, 503]);
const BASE_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 300_000;
const MIN_GAP_MS = 1_000;
const MAX_RETRIES = 3;

let rateLimitedUntil = 0;
let consecutiveRateLimits = 0;
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SubgraphStatus {
  available: boolean;
  rateLimitedUntil: number | null;
  cooldownSeconds: number;
}

/** When false, callers should skip subgraph and use RPC or cached defaults. */
export function isSubgraphAvailable(): boolean {
  return Date.now() >= rateLimitedUntil;
}

export function getSubgraphStatus(): SubgraphStatus {
  const remaining = rateLimitedUntil - Date.now();
  return {
    available: remaining <= 0,
    rateLimitedUntil: remaining > 0 ? rateLimitedUntil : null,
    cooldownSeconds: remaining > 0 ? Math.ceil(remaining / 1000) : 0,
  };
}

function markRateLimited(status: number): void {
  consecutiveRateLimits += 1;
  const cooldown = Math.min(
    BASE_COOLDOWN_MS * 2 ** (consecutiveRateLimits - 1),
    MAX_COOLDOWN_MS,
  );
  rateLimitedUntil = Date.now() + cooldown;
  console.warn(
    `[subgraph] HTTP ${status} — pausing all subgraph queries for ${Math.round(cooldown / 1000)}s`,
  );
}

function markSuccess(): void {
  consecutiveRateLimits = 0;
  rateLimitedUntil = 0;
}

async function fetchOnce<T>(
  endpoint: SubgraphEndpoint,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (endpoint.apiKey) {
    headers.authorization = `Bearer ${endpoint.apiKey}`;
  }

  const res = await fetch(endpoint.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      message: text.slice(0, 200) || `HTTP ${res.status}`,
    };
  }

  const body = (await res.json()) as GraphqlResponse<T>;
  if (body.errors?.length) {
    return { ok: false, status: 200, message: body.errors.map((e) => e.message).join("; ") };
  }
  if (!body.data) {
    return { ok: false, status: 200, message: "Subgraph returned no data" };
  }

  return { ok: true, data: body.data };
}

async function executeQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!isSubgraphAvailable()) {
    throw new Error("Subgraph temporarily rate-limited");
  }

  const endpoint = resolveSubgraphEndpoint();
  let lastError = "Subgraph query failed";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const gapWait = MIN_GAP_MS - (Date.now() - lastRequestAt);
    if (gapWait > 0) await sleep(gapWait);
    lastRequestAt = Date.now();

    const result = await fetchOnce<T>(endpoint, query, variables);
    if (result.ok) {
      markSuccess();
      return result.data;
    }

    lastError = result.message;
    const retryable = RETRYABLE_STATUSES.has(result.status);
    if (!retryable || attempt === MAX_RETRIES) {
      if (retryable) markRateLimited(result.status);
      throw new Error(`Subgraph query failed: ${lastError}`);
    }

    const backoff = MIN_GAP_MS * 2 ** (attempt + 1);
    console.warn(`[subgraph] HTTP ${result.status} — retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`);
    await sleep(backoff);
  }

  throw new Error(`Subgraph query failed: ${lastError}`);
}

/** Serialized globally — one in-flight subgraph request at a time. */
export function querySubgraph<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const next = chain.then(() => executeQuery<T>(query, variables));
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
