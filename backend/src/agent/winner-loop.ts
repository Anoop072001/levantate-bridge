import { runWinnerSelectionCycle } from "./runner.js";

let winnerTimer: ReturnType<typeof setInterval> | undefined;

function runWinnerSelectionSafely(): void {
  void runWinnerSelectionCycle()
    .then((result) => {
      for (const action of result.actions) {
        if (action.error) {
          console.warn(`[agent] task ${action.taskId} select_winner failed: ${action.error}`);
        } else if (action.transaction) {
          console.log(
            `[agent] task ${action.taskId} select_winner submitted (${action.transaction.status})`,
          );
        }
      }
    })
    .catch((err) => {
      console.warn("[agent] winner selection error:", err instanceof Error ? err.message : err);
    });
}

export function startWinnerSelectionLoop(intervalMs = 30_000): void {
  if (winnerTimer) return;
  runWinnerSelectionSafely();
  winnerTimer = setInterval(runWinnerSelectionSafely, intervalMs);
  console.log(`Winner selection loop enabled (every ${intervalMs / 1000}s, runs immediately on start)`);
}

export function stopWinnerSelectionLoop(): void {
  if (winnerTimer) {
    clearInterval(winnerTimer);
    winnerTimer = undefined;
  }
}
