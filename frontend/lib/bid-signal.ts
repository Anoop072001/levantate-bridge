/**
 * Binds a Selfie Check proof to one specific bid. Mirrored from `bidSignal` in
 * `backend/src/routes/tasks.ts` — the two must stay identical or bids will be rejected.
 */
export function bidSignal(taskId: number, round: number, amountMicro: number): string {
  return `bid:${taskId}:${round}:${amountMicro}`;
}
