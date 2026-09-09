import { consumePendingSignal, insertPendingSignal } from "../store.js";

/** Long enough for opening World App, completing a face scan, and returning. */
export const SIGNAL_TTL_MS = 20 * 60 * 1000;

const memoryFallback = new Map<string, { signal: string; expiresAt: number }>();
let warnedMissingTable = false;

function warnMissingTable(): void {
  if (warnedMissingTable) return;
  warnedMissingTable = true;
  console.warn(
    "[world-id] pending_signals table missing in Supabase — using in-memory fallback. " +
      "Run backend/supabase/schema-add-pending-signals.sql in the Supabase SQL editor.",
  );
}

function isMissingTableError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("pending_signals");
}

export function createSignalToken(): string {
  return crypto.randomUUID();
}

export async function registerExpectedSignal(token: string, signal: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SIGNAL_TTL_MS).toISOString();
  try {
    await insertPendingSignal(token, signal, expiresAt);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    warnMissingTable();
    memoryFallback.set(token, { signal, expiresAt: Date.parse(expiresAt) });
  }
}

export async function consumeExpectedSignal(token: string, signal: string): Promise<boolean> {
  try {
    return await consumePendingSignal(token, signal);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    warnMissingTable();
  }

  const entry = memoryFallback.get(token);
  memoryFallback.delete(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  return entry.signal === signal;
}
