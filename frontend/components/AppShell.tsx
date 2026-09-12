"use client";

import { usePathname } from "next/navigation";
import { MobileDesktopNotice } from "@/components/MobileDesktopNotice";
import { SiteHeader } from "@/components/SiteHeader";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  if (isHome) {
    return <>{children}</>;
  }

  return (
    <>
      <MobileDesktopNotice />
      <div className="hidden md:contents">
        <SiteHeader />
        {children}
      </div>
    </>
  );
}
