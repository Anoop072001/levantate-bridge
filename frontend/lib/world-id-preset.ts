import { selfieCheckLegacy } from "@worldcoin/idkit";

export function verificationPreset(signal: string) {
  return selfieCheckLegacy({ signal });
}
