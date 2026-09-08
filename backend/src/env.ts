import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_ENV = resolve(import.meta.dirname, "../../.env.local");

export function loadRootEnv(): void {
  const text = readFileSync(ROOT_ENV, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1).trim();
    process.env[key] = value;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in .env.local`);
  }
  return value;
}

export function upsertRootEnv(updates: Record<string, string>): void {
  const lines = readFileSync(ROOT_ENV, "utf8").split("\n");
  const keys = new Set(Object.keys(updates));
  const kept = lines.filter((line) => {
    const key = line.split("=")[0]?.trim();
    return !key || !keys.has(key);
  });
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  for (const [key, value] of Object.entries(updates)) {
    kept.push(`${key}=${value}`);
  }
  writeFileSync(ROOT_ENV, `${kept.join("\n")}\n`, "utf8");
}
