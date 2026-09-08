const pending = new Map<string, { signal: string; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export function registerExpectedSignal(token: string, signal: string): void {
  pending.set(token, { signal, expiresAt: Date.now() + TTL_MS });
}

export function consumeExpectedSignal(token: string, signal: string): boolean {
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) return false;
  return entry.signal === signal;
}

export function createSignalToken(): string {
  return crypto.randomUUID();
}
