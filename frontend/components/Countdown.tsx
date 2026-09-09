"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCountdown, secondsRemaining } from "@/lib/time";

export function Countdown({
  deadlineUnix,
  label,
  className,
}: {
  deadlineUnix: string;
  label?: string;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const tick = () => setRemaining(secondsRemaining(deadlineUnix));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineUnix]);

  const expired = remaining <= 0;
  const text = mounted ? formatCountdown(remaining) : "…";

  return (
    <span className={cn(expired ? "text-red-700" : "text-muted-foreground", className)}>
      {label ? `${label}: ${text}` : text}
    </span>
  );
}
