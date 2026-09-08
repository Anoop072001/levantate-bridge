import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface WorkerRecord {
  nullifierHash: string;
  circleWalletId: string;
  address: string;
  signal: string;
  createdAt: string;
}

interface StoreData {
  workers: WorkerRecord[];
}

const DATA_PATH = resolve(import.meta.dirname, "../data/workers.json");

function load(): StoreData {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf8")) as StoreData;
  } catch {
    return { workers: [] };
  }
}

function save(data: StoreData): void {
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function findWorkerByNullifier(nullifierHash: string): WorkerRecord | undefined {
  const normalized = nullifierHash.toLowerCase();
  return load().workers.find((w) => w.nullifierHash.toLowerCase() === normalized);
}

export function insertWorker(record: WorkerRecord): void {
  const data = load();
  if (data.workers.some((w) => w.nullifierHash.toLowerCase() === record.nullifierHash.toLowerCase())) {
    throw new Error("Nullifier already registered");
  }
  data.workers.push(record);
  save(data);
}
