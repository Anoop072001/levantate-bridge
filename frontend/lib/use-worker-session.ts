"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { setRegisteredNullifier } from "./registered-nullifier";
import { clearWorkerSession, getWorkerSession } from "./worker-session";
import { isStalePayoutSession } from "./payout-session";
import type { WorkerSession } from "./types";

export function useWorkerSession() {
  const { address: connectedAddress } = useAccount();
  const [session, setSession] = useState<WorkerSession | null>(null);
  const [ready, setReady] = useState(false);
  const [clearedStale, setClearedStale] = useState(false);

  useEffect(() => {
    const sync = () => {
      let next = getWorkerSession();
      if (isStalePayoutSession(next, connectedAddress)) {
        if (next?.nullifierHash) {
          setRegisteredNullifier(next.nullifierHash);
        }
        clearWorkerSession();
        next = null;
        setClearedStale(true);
      } else {
        setClearedStale(false);
      }
      setSession(next);
      setReady(true);
    };
    sync();
    window.addEventListener("levantate-session", sync);
    return () => window.removeEventListener("levantate-session", sync);
  }, [connectedAddress]);

  return { session, ready, clearedStale, connectedAddress };
}
