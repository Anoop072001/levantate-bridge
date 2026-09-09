/**
 * Applies backend/supabase/schema-add-pending-signals.sql.
 * Supabase JS cannot run DDL — paste the file into the Supabase SQL editor, or run:
 *   psql "$DATABASE_URL" -f backend/supabase/schema-add-pending-signals.sql
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRootEnv } from "../src/env.js";
import { getSupabase } from "../src/db/supabase.js";

loadRootEnv();

const sqlPath = resolve(import.meta.dirname, "../supabase/schema-add-pending-signals.sql");
const sql = readFileSync(sqlPath, "utf8");

console.log("Supabase cannot apply DDL through the JS client.");
console.log("Run this SQL in your project's SQL editor (Dashboard → SQL → New query):\n");
console.log(sql);

const supabase = getSupabase();
const probe = await supabase.from("pending_signals").select("token").limit(1);
if (probe.error?.message.includes("pending_signals")) {
  console.error("\nTable pending_signals is not present yet.");
  process.exit(1);
}

console.log("\npending_signals table is already present.");
