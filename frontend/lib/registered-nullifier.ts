const KEY = "levantate-registered-nullifier";

/** Survives session clears when the user switches connected wallets. */
export function getRegisteredNullifier(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setRegisteredNullifier(nullifierHash: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, nullifierHash);
}

export function clearRegisteredNullifier(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
