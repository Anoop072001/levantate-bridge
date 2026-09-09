import type { WorkerSession } from "./types";

const KEY = "levantate-worker-session";

export function getWorkerSession(): WorkerSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkerSession;
  } catch {
    return null;
  }
}

export function setWorkerSession(session: WorkerSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearWorkerSession(): void {
  localStorage.removeItem(KEY);
}
