import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadRootEnv, requireEnv } from "../env.js";

loadRootEnv();

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
