import { loadRootEnv } from "../src/env.js";
import { getSupabase } from "../src/db/supabase.js";

loadRootEnv();

const tables = [
  "workers",
  "tasks",
  "bids",
  "proofs",
  "relayed_transactions",
  "linked_wallets",
  "spent_proofs",
  "pending_signals",
  "agent_chats",
  "agent_chat_messages",
];

const sb = getSupabase();
for (const t of tables) {
  const r = await sb.from(t).select("*").limit(1);
  console.log(`${t}: ${r.error ? `MISSING (${r.error.message.split("\n")[0]})` : "ok"}`);
}

const bucket = await sb.storage.from("proof-files").list("", { limit: 1 });
console.log(
  `proof-files bucket: ${bucket.error ? `MISSING (${bucket.error.message})` : "ok"}`,
);

const chatStatus = await sb.from("agent_chats").select("status").limit(1);
if (!chatStatus.error) {
  console.log(`agent_chats.status column: ${chatStatus.error ? "missing" : "ok"}`);
}
