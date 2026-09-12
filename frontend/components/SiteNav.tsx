"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Brand } from "@/components/Brand";
import { ConnectCta } from "@/components/ConnectCta";
import { cn } from "@/lib/cn";
import { NAV_ITEMS } from "@/lib/nav-items";

type SiteNavVariant = "dark" | "light";

const linkClass: Record<SiteNavVariant, string> = {
  dark: "text-white/70 transition-colors hover:text-white",
  light: "text-muted-foreground transition-colors hover:text-foreground",
};

const menuButtonClass: Record<SiteNavVariant, string> = {
  dark: "text-white/80 hover:bg-white/10",
  light: "text-foreground hover:bg-muted",
};

const panelClass: Record<SiteNavVariant, string> = {
  dark: "border-white/10 bg-black/95 backdrop-blur-md",
  light: "border-border bg-background/95 backdrop-blur-md",
};

const mobileLinkClass: Record<SiteNavVariant, string> = {
  dark: "text-white/90 hover:bg-white/10",
  light: "text-foreground hover:bg-muted",
};

export function SiteNav({
  variant = "light",
  brandClassName,
}: {
  variant?: SiteNavVariant;
  brandClassName?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);

  const mobileMenu =
    menuOpen && mounted
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200] bg-black/50 md:hidden"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            />
            <div
              id="mobile-nav-panel"
              className={cn(
                "fixed top-[calc(env(safe-area-inset-top,0px)+4.5rem)] right-4 left-4 z-[210] overflow-hidden rounded-2xl border shadow-2xl md:hidden",
                panelClass[variant],
              )}
            >
              <nav className="flex flex-col p-2" aria-label="Mobile">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn("rounded-xl px-4 py-3 text-base font-medium", mobileLinkClass[variant])}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div
                className={cn(
                  "border-t p-3 sm:hidden",
                  variant === "dark" ? "border-white/10" : "border-border",
                )}
              >
                <ConnectCta variant={variant === "dark" ? "dark" : "light"} />
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="relative z-50">
      <div className="flex items-center justify-between gap-3">
        <Brand className={cn(variant === "dark" ? "text-white" : "text-foreground", brandClassName)} />

        <nav className="hidden items-center gap-6 md:flex lg:gap-10" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={cn("text-sm font-medium", linkClass[variant])}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden sm:block">
            <ConnectCta variant={variant === "dark" ? "dark" : "light"} />
          </div>
          <button
            type="button"
            className={cn(
              "relative z-[220] inline-flex h-10 w-10 items-center justify-center rounded-lg md:hidden",
              menuButtonClass[variant],
            )}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-panel"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {mobileMenu}
    </div>
  );
}
