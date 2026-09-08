import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { loadRootEnv, requireEnv } from "../env.js";

loadRootEnv();

export function createCircleClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: requireEnv("CIRCLE_API_KEY"),
    entitySecret: requireEnv("CIRCLE_ENTITY_SECRET"),
  });
}
