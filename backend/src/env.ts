import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repo root `.env.local` — primary path for local dev (works from `src/` and compiled `dist/src/`). */
export const ROOT_ENV = resolve(import.meta.dirname, "../../../.env.local");

const ENV_FILE_CANDIDATES = [
  ROOT_ENV,
  resolve(import.meta.dirname, "../../.env.local"),
  resolve(import.meta.dirname, "../.env.local"),
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), "../.env.local"),
  "/etc/secrets/.env.local",
];

function parseEnvFile(text: string): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1).trim();
    // Platform env (Render dashboard, etc.) wins over file values.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Loads `.env.local` from known paths when present. Skips if none exist — use host dashboard env. */
export function loadRootEnv(): void {
  for (const path of ENV_FILE_CANDIDATES) {
    if (!existsSync(path)) continue;
    parseEnvFile(readFileSync(path, "utf8"));
    return;
  }
}

export function envConfigured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in environment (set in .env.local locally or host dashboard)`);
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
