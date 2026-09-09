"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LinkWalletButton } from "@/components/LinkWalletButton";
import { PageFrame } from "@/components/PageFrame";
import { shortAddress } from "@/lib/task-display";
import { useWorkerSession } from "@/lib/use-worker-session";

function VerifyContent() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("return");
  const { session } = useWorkerSession();

  return (
    <PageFrame className="max-w-xl">
      <div className="mb-10 space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Link payout wallet</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Connect with RainbowKit, then sign a free off-chain message. Signing moves nothing. Selfie
          Check is <strong>not</strong> part of this step — every bid requires its own proof.
        </p>
      </div>

      <div className="flex justify-center">
        {session ? (
          <p className="text-sm text-emerald-700">
            Linked <code className="text-foreground">{shortAddress(session.walletAddress)}</code>
          </p>
        ) : (
          <LinkWalletButton
            onLinked={() => {
              if (returnTo?.startsWith("/")) window.location.href = returnTo;
            }}
          />
        )}
      </div>
    </PageFrame>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <PageFrame>
          <p className="text-muted-foreground">Loading…</p>
        </PageFrame>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
