# World ID Selfie Check — integration reference

Selfie Check gates **economic participation**: every bid and every payout-address change requires a fresh proof. Identity comes from the proof’s **nullifier hash**, never from client-supplied values.

## What it does here

| Moment | Selfie Check signal |
| ------ | ------------------- |
| **Place bid** | `bid:{taskId}:{round}:{amountMicro}` |
| **Change payout wallet** | `change-payout:{newAddressLowercase}` |

First successful bid binds **nullifier → payout address** in Supabase. Registered workers can later rotate payout address with a fresh Selfie Check + new wallet signature (`POST /api/worker/change-payout-wallet`).

## Code files

### Backend — verification

| File | Role |
| ---- | ---- |
| `backend/src/world-id/verify.ts` | `POST developer.world.org/api/v4/verify/{rp_id}`, proof spend |
| `backend/src/world-id/signals.ts` | RP signal tokens, TTL, pending-signal store |
| `backend/src/world-id/nullifier.ts` | Extract nullifier from IDKit response |
| `backend/src/server.ts` | `GET /api/world-id/config`, `POST /api/world-id/rp-signature` |
| `backend/src/routes/tasks.ts` | Bid route — verify proof, bind/register worker |
| `backend/src/routes/worker.ts` | `changePayoutSignal`, `POST /api/worker/change-payout-wallet` |
| `backend/src/wallet/challenge.ts` | Off-chain ownership challenge (before Selfie Check on first bid) |
| `backend/src/store.ts` | `workers`, `linked_wallets`, `spent_proofs`, `updateWorkerAddress` |
| `backend/scripts/apply-pending-signals.ts` | Apply `pending_signals` migration helper |

### Frontend — IDKit

| File | Role |
| ---- | ---- |
| `frontend/components/SelfieCheck.tsx` | IDKit widget, fetches RP signature, runs verification |
| `frontend/lib/world-id-preset.ts` | `selfieCheckLegacy()` preset config |
| `frontend/lib/bid-signal.ts` | Bid signal string (must match backend) |
| `frontend/lib/change-payout-signal.ts` | Change-payout signal (must match backend) |
| `frontend/components/BidSheet.tsx` | Bid flow — wallet link then Selfie Check |
| `frontend/components/ChangePayoutWallet.tsx` | Registered worker payout rotation |
| `frontend/components/LinkWalletButton.tsx` | Connect + sign wallet ownership |
| `frontend/lib/link-wallet.ts` | Challenge/sign/link API client |
| `frontend/app/verify/page.tsx` | Standalone link payout wallet page |
| `frontend/lib/payout-session.ts` | Session readiness / stale payout detection |
| `frontend/lib/worker-session.ts` | localStorage worker session |

### Database

| File | Role |
| ---- | ---- |
| `backend/supabase/schema.sql` | `workers`, `linked_wallets`, `spent_proofs`, `pending_signals` |

### Other

| File | Role |
| ---- | ---- |
| `docs/selfie-check-feedback.md` | Beta access / product feedback notes for TFH |

## Key env vars

- `WORLD_APP_ID`, `WORLD_RP_ID` — public IDKit config
- `WORLD_SIGNING_KEY` — server-only RP signature (never client)
- `WORLD_ID_ACTION` — action string signed into `rp_context`
- `NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_RP_ID` — frontend mirror

## Flow summary

1. Worker connects wallet → signs challenge → `linked_wallets` row (until first bid).
2. Worker opens Selfie Check with task-bound signal → backend verifies + spends proof.
3. First bid inserts `workers(nullifier_hash, address)`.
4. To change payout: sign **new** wallet → Selfie Check with `change-payout:0x…` → `updateWorkerAddress`.

See [`AGENTS.md`](../AGENTS.md) for sandbox vs staging, `allow_legacy_proofs`, and access-gate notes.
