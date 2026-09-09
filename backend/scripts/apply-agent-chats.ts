import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRootEnv } from "../src/env.js";
import { getSupabase } from "../src/db/supabase.js";

loadRootEnv();

const sqlPath = resolve(import.meta.dirname, "../supabase/schema-add-agent-chats.sql");
console.log("Run this SQL in Supabase (Dashboard → SQL → New query):\n");
console.log(readFileSync(sqlPath, "utf8"));

const probe = await getSupabase().from("agent_chats").select("id").limit(1);
if (probe.error?.message.includes("agent_chats")) {
  console.error("\nTable agent_chats is not present yet.");
  process.exit(1);
}

console.log("\nagent_chats tables are already present.");
