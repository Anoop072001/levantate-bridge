import { orbLegacy } from "@worldcoin/idkit";

/**
 * Swap to `selfieCheckLegacy({ signal })` once Selfie Check access is granted (D4).
 */
export function verificationPreset(signal: string) {
  return orbLegacy({ signal });
}
