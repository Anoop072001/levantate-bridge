import { requireEnv } from "../env.js";

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const RETRYABLE_STATUSES = new Set([429, 503]);
const BASE_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 300_000;
const MIN_GAP_MS = 250;

let rateLimitedUntil = 0;
let consecutiveRateLimits = 0;
let lastRequestAt = 0;
let chain: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** When false, callers should skip subgraph and use RPC or cached defaults. */
export function isSubgraphAvailable(): boolean {
  return Date.now() >= rateLimitedUntil;
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

async function executeQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!isSubgraphAvailable()) {
    throw new Error("Subgraph temporarily rate-limited");
  }

  const gapWait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (gapWait > 0) await sleep(gapWait);
  lastRequestAt = Date.now();

  const url = requireEnv("SUBGRAPH_QUERY_URL");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    if (RETRYABLE_STATUSES.has(res.status)) {
      markRateLimited(res.status);
    }
    throw new Error(`Subgraph query failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as GraphqlResponse<T>;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) {
    throw new Error("Subgraph returned no data");
  }

  markSuccess();
  return body.data;
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
