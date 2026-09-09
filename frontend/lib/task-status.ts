import { secondsRemaining } from "./time";
import type { Task } from "./types";

/** Bidding is allowed only while the on-chain window is Open/Bidding and before the deadline. */
export function isBiddingOpen(task: Task): boolean {
  return (task.state === 0 || task.state === 1) && secondsRemaining(task.bidDeadline) > 0;
}

/**
 * Human-readable status for the UI. On-chain state stays `Open` until the first bid lands,
 * so a task can read Open in the contract while its bid deadline has already passed.
 */
export function taskDisplayStatus(task: Task): string {
  const inBidWindow = task.state === 0 || task.state === 1;
  const deadlinePassed = secondsRemaining(task.bidDeadline) <= 0;

  if (inBidWindow && deadlinePassed) {
    return Number(task.currentRoundBidCount) > 0 ? "Selecting bidder" : "Bidding closed";
  }

  if (inBidWindow && !deadlinePassed) {
    return task.state === 0 ? "Open" : "Bidding";
  }

  return task.stateLabel;
}
