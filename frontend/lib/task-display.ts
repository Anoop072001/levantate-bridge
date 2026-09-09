import { usdcMicroToDisplay } from "./api";
import type { Task } from "./types";

export function taskHeadline(description: string): string {
  const first = description.split(/[.!?]/)[0]?.trim() || description;
  if (first.length <= 72) return first;
  return `${first.slice(0, 69)}…`;
}

export function usdcParts(display: string): { whole: string; cents: string } {
  const n = Number(display);
  if (!Number.isFinite(n)) return { whole: "0", cents: ".00" };
  const [whole, frac] = n.toFixed(2).split(".");
  return {
    whole: whole.replace(/\B(?=(\d{3})+(?!\d))/g, " "),
    cents: `.${frac}`,
  };
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function taskBudgetLabel(task: Task): string {
  return `${usdcMicroToDisplay(task.maxBudget)} USDC`;
}
