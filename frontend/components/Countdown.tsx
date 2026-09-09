"use client";

import { useEffect, useState } from "react";
import { formatCountdown, secondsRemaining } from "@/lib/time";

export function Countdown({ deadlineUnix, label }: { deadlineUnix: string; label: string }) {
  const [remaining, setRemaining] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const tick = () => setRemaining(secondsRemaining(deadlineUnix));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadlineUnix]);

  if (!mounted) {
    return (
      <p style={{ color: "#333" }}>
        {label}: …
      </p>
    );
  }

  const expired = remaining <= 0;

  return (
    <p style={{ color: expired ? "crimson" : "#333" }}>
      {label}: {formatCountdown(remaining)}
    </p>
  );
}
