import { Brand } from "@/components/Brand";
import { Monitor } from "lucide-react";

/** Blocks the entire app below the md breakpoint — demo flows require a desktop browser. */
export function MobileDesktopNotice() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6 text-center md:hidden">
      <Brand className="mb-10 text-foreground" />
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted">
          <Monitor className="h-7 w-7 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="font-serif text-2xl italic tracking-wide text-foreground">Desktop only</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Levantate Bridge is built for a <span className="font-medium text-foreground">laptop or desktop</span>{" "}
          browser. Open this site on a larger screen to browse tasks, bid, and link your wallet.
        </p>
      </div>
    </div>
  );
}
