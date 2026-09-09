import { backendUrl } from "./config";
import type { Bid, RelayedTransaction, Task } from "./types";

async function parseJson<T>(res: Response): Promise<T & { error?: string }> {
  return res.json() as Promise<T & { error?: string }>;
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${backendUrl}/api/tasks`, { cache: "no-store" });
  const data = await parseJson<{ tasks: Task[] }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to load tasks");
  return data.tasks;
}

export async function fetchTask(id: number): Promise<Task> {
  const res = await fetch(`${backendUrl}/api/tasks/${id}`, { cache: "no-store" });
  const data = await parseJson<{ task: Task }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to load task");
  return data.task;
}

export async function fetchBids(taskId: number, round?: number): Promise<Bid[]> {
  const url =
    round === undefined
      ? `${backendUrl}/api/tasks/${taskId}/bids`
      : `${backendUrl}/api/tasks/${taskId}/bids?round=${round}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await parseJson<{ bids: Bid[] }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to load bids");
  return data.bids;
}

export async function fetchWorkerBalance(address: string): Promise<string> {
  const res = await fetch(`${backendUrl}/api/workers/${address}/balance`, { cache: "no-store" });
  const data = await parseJson<{ usdcBalance: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "Failed to load balance");
  return data.usdcBalance;
}

export async function placeBid(taskId: number, nullifierHash: string, amountMicroUsdc: number) {
  const res = await fetch(`${backendUrl}/api/tasks/${taskId}/bids`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nullifierHash, amount: amountMicroUsdc }),
  });
  const data = await parseJson<RelayedTransaction>(res);
  if (!res.ok) throw new Error(data.error ?? "Bid failed");
  return data;
}

export async function submitProof(
  taskId: number,
  nullifierHash: string,
  content: string,
  link?: string,
) {
  const res = await fetch(`${backendUrl}/api/tasks/${taskId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nullifierHash, content, link }),
  });
  const data = await parseJson<RelayedTransaction>(res);
  if (!res.ok) throw new Error(data.error ?? "Submit failed");
  return data;
}

export async function fetchTransaction(id: string): Promise<RelayedTransaction> {
  const res = await fetch(`${backendUrl}/api/transactions/${id}`, { cache: "no-store" });
  const data = await parseJson<RelayedTransaction>(res);
  if (!res.ok) throw new Error(data.error ?? "Transaction not found");
  return data;
}

export function usdcMicroToDisplay(micro: string | number): string {
  const n = typeof micro === "string" ? Number(micro) : micro;
  return (n / 1_000_000).toFixed(2);
}

export function usdcDisplayToMicro(display: string): number {
  return Math.round(parseFloat(display) * 1_000_000);
}

export const ARC_EXPLORER = "https://testnet.arcscan.app";
