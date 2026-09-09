"use client";

import { useEffect, useState } from "react";
import { getWorkerSession } from "./worker-session";
import type { WorkerSession } from "./types";

export function useWorkerSession() {
  const [session, setSession] = useState<WorkerSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(getWorkerSession());
    setReady(true);
  }, []);

  return { session, ready };
}
