export function secondsRemaining(deadlineUnix: string): number {
  return Math.max(0, Number(deadlineUnix) - Math.floor(Date.now() / 1000));
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
