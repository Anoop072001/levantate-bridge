import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRootEnv } from "../src/env.js";
import { getSupabase } from "../src/db/supabase.js";

loadRootEnv();

const sqlPath = resolve(import.meta.dirname, "../supabase/schema-add-agents.sql");
console.log("Run this SQL in Supabase (Dashboard → SQL → New query):\n");
console.log(readFileSync(sqlPath, "utf8"));

const agents = await getSupabase().from("agents").select("id").limit(1);
if (agents.error) {
  console.error("\nagents table is not present yet:", agents.error.message);
  process.exit(1);
}

const poster = await getSupabase().from("tasks").select("poster").limit(1);
if (poster.error) {
  console.error("\ntasks.poster column is not present yet:", poster.error.message);
  process.exit(1);
}

console.log("\nagents table and tasks.poster are already present.");
