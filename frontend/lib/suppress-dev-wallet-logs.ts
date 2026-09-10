/** Dev-only: hide Reown allowlist / Lit noise when localhost is not on the WC cloud allowlist. */
const SUPPRESSED = [
  /\[Reown Config\]/i,
  /not found on Allowlist/i,
  /cloud\.reown\.com/i,
  /Lit is in dev mode/i,
];

function shouldSuppress(args: unknown[]): boolean {
  const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  return SUPPRESSED.some((re) => re.test(text));
}

function installDevWalletLogSuppress(): void {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "development") return;
  const flag = "__levantateSuppressWalletLogs" as const;
  if ((window as unknown as Record<string, boolean>)[flag]) return;
  (window as unknown as Record<string, boolean>)[flag] = true;

  const origWarn = console.warn;
  const origError = console.error;

  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(args)) return;
    origWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    if (shouldSuppress(args)) return;
    origError.apply(console, args);
  };
}

installDevWalletLogSuppress();
