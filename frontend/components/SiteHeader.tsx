"use client";

import Link from "next/link";
import { Brand } from "@/components/Brand";
import { ConnectCta } from "@/components/ConnectCta";

const navItems = [
  { href: "/tasks", label: "Tasks" },
  { href: "/wallet", label: "Wallet" },
  { href: "/verify?return=/tasks", label: "Link wallet" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
        <Brand className="text-foreground" />
        <nav className="flex items-center gap-4 md:gap-8">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <ConnectCta variant="light" />
      </div>
    </header>
  );
}
