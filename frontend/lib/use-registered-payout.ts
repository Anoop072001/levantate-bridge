"use client";

import { useEffect, useState } from "react";
import { fetchRegisteredPayout } from "./api";
import { getRegisteredNullifier, setRegisteredNullifier } from "./registered-nullifier";
import { getWorkerSession, setWorkerSession } from "./worker-session";
import type { RegisteredPayout } from "./payout-session";

function restoreWorldIdInSession(registered: RegisteredPayout | null): void {
  if (!registered) return;
  const session = getWorkerSession();
  if (
    session?.walletAddress &&
    session.walletAddress.toLowerCase() === registered.registeredAddress.toLowerCase() &&
    !session.nullifierHash
  ) {
    setWorkerSession({ ...session, nullifierHash: registered.nullifierHash });
  }
}

export function useRegisteredPayout(nullifierHash?: string, walletAddress?: string) {
  const [registeredPayout, setRegisteredPayout] = useState<RegisteredPayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupHash = nullifierHash ?? getRegisteredNullifier() ?? undefined;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (lookupHash) {
          const byNullifier = await fetchRegisteredPayout({ nullifierHash: lookupHash });
          if (cancelled) return;
          setRegisteredPayout(byNullifier);
          setError(null);
          if (byNullifier?.nullifierHash) {
            setRegisteredNullifier(byNullifier.nullifierHash);
          }
          restoreWorldIdInSession(byNullifier);
          return;
        }

        if (walletAddress) {
          const byWallet = await fetchRegisteredPayout({ walletAddress });
          if (cancelled) return;
          setRegisteredPayout(byWallet);
          setError(null);
          if (byWallet?.nullifierHash) {
            setRegisteredNullifier(byWallet.nullifierHash);
          }
          restoreWorldIdInSession(byWallet);
          return;
        }

        setRegisteredPayout(null);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setRegisteredPayout(null);
        setError(err instanceof Error ? err.message : "Failed to load registration");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [lookupHash, walletAddress]);

  return { registeredPayout, loading, error, lookupHash };
}
