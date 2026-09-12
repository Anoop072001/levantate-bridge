# World ID Selfie Check — integration reference

Selfie Check gates **economic participation**: every bid and every payout-address change requires a fresh proof. Identity comes from the proof’s **nullifier hash**, never from client-supplied values.

**Start here if you are reviewing World ID / Selfie Check integration.**

## What it does here

| Moment | Signal format | Entry point |
| ------ | ------------- | ----------- |
| **Place bid** | `bid:{taskId}:{round}:{amountMicro}` | `POST /api/tasks/:id/bids` |
| **Change payout wallet** | `change-payout:{newAddressLowercase}` | `POST /api/worker/change-payout-wallet` |

First successful bid binds **nullifier → payout address** in Supabase (`workers` table). Registered workers rotate payout with a fresh Selfie Check + new wallet signature.

## Verification pipeline (backend)

`backend/src/world-id/verify.ts` — full server-side path:

```typescript
export async function verifySelfieCheck(input: ProofSubmission): Promise<ProofOutcome> {
  const signalOk = await consumeExpectedSignal(input.signalToken, input.signal);
  if (!signalOk) return { ok: false, status: 400, error: "Signal mismatch or expired verification session" };

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input.idkitResponse))
    .digest("hex");

  const res = await fetch(`${WORLD_VERIFY_BASE}/${input.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.idkitResponse),
  });
  // … extract nullifier, then:
  const spent = await trySpendProof(fingerprint, nullifierHash, input.taskId);
  if (!spent) return { ok: false, status: 409, error: "This Selfie Check proof has already been used" };

  return { ok: true, nullifierHash };
}
```

Supporting modules:

| File | Role |
| ---- | ---- |
| `backend/src/world-id/signals.ts` | RP signal tokens, 20 min TTL, `pending_signals` store |
| `backend/src/world-id/nullifier.ts` | Extract nullifier from IDKit response |
| `backend/src/world-id/spent-proofs-cleanup.ts` | Delete bid fingerprints when task paid/cancelled/reclaimed |
| `backend/src/server.ts` | `GET /api/world-id/config`, `POST /api/world-id/rp-signature` |

### Bid route (verify → bind → relay)

`backend/src/routes/tasks.ts` — signal must match task/round/amount before World verify:

```typescript
const expectedSignal = bidSignal(taskId, onChain.round, amountStr);
if (input.signal !== expectedSignal) {
  json(400, { error: "Selfie Check proof was issued for a different task, round, or amount" });
  return true;
}

const proof = await verifySelfieCheck({
  rpId: input.rp_id ?? requireEnv("WORLD_RP_ID"),
  idkitResponse: input.idkitResponse,
  signal: input.signal,
  signalToken: input.signal_token,
  taskId,
});
// nullifier read from proof — never from client
```

Signal helper (must match frontend): `frontend/lib/bid-signal.ts` / `backend/src/routes/tasks.ts` → `bidSignal`.

### Proof spend + cleanup

`backend/src/store.ts` — `trySpendProof(fingerprint, nullifierHash, taskId?)` inserts into `spent_proofs`. Bid rows include `task_id`; change-payout rows leave it null.

Cleanup after confirmed on-chain pay/cancel/reclaim — `backend/src/world-id/spent-proofs-cleanup.ts`:

```typescript
const CLEANUP_ON_CONFIRMED = new Set(["approve_work", "cancel_task", "abort_task", "reclaim_task"]);

export async function maybeDeleteSpentProofsForTask(kind: string, taskId: number | undefined) {
  if (taskId === undefined || !CLEANUP_ON_CONFIRMED.has(kind)) return;
  await deleteSpentProofsForTask(taskId);
}
```

Called from `backend/src/relayer/submit.ts` and `backend/src/relayer/reconcile.ts` after Arc RPC confirms.

### Change payout wallet

`backend/src/routes/worker.ts` — `changePayoutSignal(address)` + `verifySelfieCheck` (no `taskId`).

### Wallet ownership (before first bid)

Off-chain challenge — not World ID:

- `backend/src/wallet/challenge.ts`, `backend/src/routes/wallet.ts`
- `frontend/lib/link-wallet.ts`, `frontend/components/LinkWalletButton.tsx`

## Frontend (IDKit)

`frontend/components/SelfieCheck.tsx` — fetches backend-signed `rp_context`, runs IDKit:

```typescript
/**
 * Runs one Selfie Check bound to `signal`. Each press produces a fresh proof: the backend
 * spends it once, so a verification cannot be replayed across bids.
 */
export function SelfieCheckButton({ signal, onVerified, ... }) {
  // POST /api/world-id/rp-signature { signal } → rp_context + signal_token
  // IDKitRequestWidget with verificationPreset (selfieCheckLegacy)
}
```

Bid UX: `frontend/components/BidSheet.tsx` — wallet link → amount → Selfie Check → `placeBid`.

Preset: `frontend/lib/world-id-preset.ts` (`selfieCheckLegacy()`, sandbox).

## Database

| Table | Role |
| ----- | ---- |
| `workers` | `nullifier_hash` ↔ payout `address` (one-to-one) |
| `linked_wallets` | Pre-bid wallet link until first Selfie Check bid |
| `spent_proofs` | `fingerprint` (SHA-256 of IDKit JSON), optional `task_id` for bids |
| `pending_signals` | One-time signal token until verify or TTL |

Schema: `backend/supabase/schema.sql`. Migration for `task_id`: `backend/supabase/schema-add-spent-proofs-task-id.sql`.

## Flow summary

1. Worker connects wallet → signs challenge → `linked_wallets` row (until first bid).
2. Worker opens Selfie Check with task-bound signal → backend verifies + spends proof.
3. First bid inserts `workers(nullifier_hash, address)`.
4. To change payout: sign **new** wallet → Selfie Check with `change-payout:0x…` → `updateWorkerAddress`.

## Key env vars

- `WORLD_APP_ID`, `WORLD_RP_ID` — public IDKit config
- `WORLD_SIGNING_KEY` — server-only RP signature (never client)
- `WORLD_ID_ACTION` — action string signed into `rp_context`
- `NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_RP_ID` — frontend mirror

## Other docs

- [`docs/selfie-check-feedback.md`](selfie-check-feedback.md) — Beta access / product feedback for TFH
- [`AGENTS.md`](../AGENTS.md) — sandbox vs staging, `allow_legacy_proofs`, access-gate notes
