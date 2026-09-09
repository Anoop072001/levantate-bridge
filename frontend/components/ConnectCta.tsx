"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import { cn, insetButtonClass, insetButtonDarkClass } from "@/lib/cn";

export function ConnectCta({ variant = "light" }: { variant?: "light" | "dark" }) {
  const buttonClass = variant === "dark" ? insetButtonClass : insetButtonDarkClass;

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) {
          return <div className="h-10 w-28 bg-zinc-200/40" aria-hidden />;
        }

        if (!account) {
          return (
            <button type="button" onClick={openConnectModal} className={buttonClass}>
              Connect
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          );
        }

        const wrongChain = chain?.unsupported;
        return (
          <button
            type="button"
            onClick={wrongChain ? openChainModal : openAccountModal}
            className={cn(buttonClass, wrongChain && "bg-red-200 text-red-950")}
          >
            {wrongChain ? "Wrong network" : account.displayName}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
