"use client";

import { useEffect, useState } from "react";
import { fetchRegisteredPayout } from "./api";
import { getRegisteredNullifier, setRegisteredNullifier } from "./registered-nullifier";
import { getWorkerSession, setWorkerSession } from "./worker-session";
import type { RegisteredPayout } from "./payout-session";

export function useRegisteredPayout(nullifierHash?: string, walletAddress?: string) {
  const [registeredPayout, setRegisteredPayout] = useState<RegisteredPayout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookupHash = nullifierHash ?? getRegisteredNullifier() ?? "";
  const lookupWallet = walletAddress ?? "";

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
          return;
        }

        if (lookupWallet) {
          const byWallet = await fetchRegisteredPayout({ walletAddress: lookupWallet });
          if (cancelled) return;
          setRegisteredPayout(byWallet);
          setError(null);
          if (byWallet?.nullifierHash) {
            setRegisteredNullifier(byWallet.nullifierHash);
          }
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
  }, [lookupHash, lookupWallet]);

  // Restore World ID into session after fetch — separate effect avoids nested setState during load.
  useEffect(() => {
    if (!registeredPayout) return;
    const session = getWorkerSession();
    if (
      session?.walletAddress &&
      session.walletAddress.toLowerCase() === registeredPayout.registeredAddress.toLowerCase() &&
      !session.nullifierHash
    ) {
      setWorkerSession({ ...session, nullifierHash: registeredPayout.nullifierHash });
    }
  }, [registeredPayout]);

  return {
    registeredPayout,
    loading,
    error,
    lookupHash: lookupHash || undefined,
  };
}
