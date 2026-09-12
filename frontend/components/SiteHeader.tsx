"use client";

import { SiteNav } from "@/components/SiteNav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-8">
        <SiteNav variant="light" />
      </div>
    </header>
  );
}
