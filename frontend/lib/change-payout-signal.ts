/**
 * Binds a Selfie Check proof to one payout-address change. Mirrored from
 * `changePayoutSignal` in `backend/src/routes/worker.ts`.
 */
export function changePayoutSignal(address: string): string {
  return `change-payout:${address.toLowerCase()}`;
}
