"use client";

import { useEffect, useState } from "react";
import { getWorkerSession } from "./worker-session";
import type { WorkerSession } from "./types";

export function useWorkerSession() {
  const [session, setSession] = useState<WorkerSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setSession(getWorkerSession());
      setReady(true);
    };
    sync();
    window.addEventListener("levantate-session", sync);
    return () => window.removeEventListener("levantate-session", sync);
  }, []);

  return { session, ready };
}
