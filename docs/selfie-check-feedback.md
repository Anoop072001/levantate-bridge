# Selfie Check integration feedback

Friction log for World ID / Selfie Check on Levantate Bridge. Updated during integration and E2E testing.

## Access gate

- Selfie Check is **Beta and access-gated** — feature flag must be enabled by `developers@toolsforhumanity.com`.
- Preset in use: **`selfieCheckLegacy()`** in `frontend/lib/world-id-preset.ts` (World ID 3.0 legacy proofs).
- `allow_legacy_proofs: true` required in IDKit config.

## Sandbox World App

- Install the **sandbox World App** build from the Developer Portal (TestFlight / private Google Play track).
- Proofs from sandbox builds are non-production.
- Device flow is required for a real proof — simulator-only testing is insufficient for end-to-end bid gating.

## RP signature (`rp_context`) — mandatory

- IDKit 4.x **refuses to open** without a valid backend-signed `rp_context`, including for legacy Selfie Check presets.
- There is no app-id-only path anymore.
- Backend: `POST /api/world-id/rp-signature` signs with `WORLD_SIGNING_KEY` (server-only, never in frontend).
- Client fetches config via `GET /api/world-id/config` (`WORLD_APP_ID`, `WORLD_RP_ID`).

## Verification

- Server forwards the **complete IDKit result unmodified** to `POST https://developer.world.org/api/v4/verify/{rp_id}`.
- Do not remap fields or hand-build `verification_level`.
- `environment: sandbox` in IDKit for testnet demo.
- Credential: `selfie` (alias `face`).

## Economic gate (not identity proof)

- Nullifier hash stored in backend DB on first successful verify.
- Second account presenting the same nullifier is rejected when it tries to bind a second payout address on the first bid.
- Framing: **economic-participation eligibility**, not strong sybil resistance — Selfie Check is medium/low assurance.

## Developer Portal — navigation, discovery, debugging

- **Three similar-looking identifiers, one of which is a secret.** `app_id` (`app_…`), `rp_id` (`rp_…`), and `signing_key` are visually adjacent in the Portal but have completely different trust levels. We lost time before internalizing that only `signing_key` is server-only.
- **A team API key looks like the credential you need, and isn't.** It authenticates the Portal management API/MCP (creating apps, minting an RP). It cannot sign `rp_context` or verify a proof. Holding one does not unblock verification — a genuine dead end while debugging.
- **The signing key is shown exactly once and is unrecoverable.** Rotating invalidates the previous signer. This is correct behavior but easy to lose on a first pass; the Portal could warn harder at the moment of reveal.
- **Product discovery pointed the wrong way.** MiniKit surfaces prominently in search, but MiniKit 2.x removed World ID verification entirely (`MiniKit.verify` and `MiniKit.commandsAsync.verify` are gone). All verification has to go through `@worldcoin/idkit`. Docs that still imply a MiniKit verification path cost real time.
- **Two verify endpoints, one legacy.** `POST https://developer.world.org/api/v4/verify/{rp_id}` handles both 4.0 and legacy 3.0 proofs; the v1 endpoint is legacy. Search surfaced v1 examples first.
- **Domain confusion:** the API lives on `world.org`, not `worldcoin.org`. Older material uses the latter.
- **No Beta flag status indicator.** With Selfie Check access pending, the widget simply fails; there is no Portal state that says "flag not yet enabled", so a permissions problem is indistinguishable from an integration bug.

## Wallet coupling — self-custodied

- The nullifier is bound **one-to-one to a wallet the worker already controls**, proved by a free off-chain `personal_sign` challenge verified server-side with viem `verifyMessage`.
- Enforced in both directions: one identity cannot register two payout addresses, and one address cannot be claimed by two identities. This makes the Selfie Check nullifier the anchor for economic eligibility without the backend ever holding worker funds.
- Workers still never sign an on-chain transaction or hold gas — the relayer submits for them. The only added step is connecting a wallet once at signup.
- Earlier iterations auto-created a custodial Circle wallet per nullifier. Replaced (see `PLAN.md` D3a) so that no backend credential compromise can move a worker's earnings.

## Dated notes

**2026-09-09 — Phase 3 scaffold**

- Initial flow built with `orbLegacy` placeholder before Selfie Check flag.
- Backend RP signature + verify routes wired; frontend `/verify` page added.

**2026-09-09 — Selfie Check preset swap**

- Swapped to `selfieCheckLegacy()` once sandbox access confirmed.
- Full device verify → bid → payout path exercised on Arc testnet.

**2026-09-09 — E2E observations**

- `rp_context` TTL and signal binding (`bid` context) prevent replay across sessions — good, but requires frontend to fetch a fresh signature before each verify attempt.
- Verification latency is acceptable for a one-time gate per worker session; re-verify not needed until session expires.
- Error surfacing: failed verify returns API error JSON; frontend should show message (implemented on task bid page).
- **Duplicate nullifier:** blocked server-side; on-chain `placeBid` never reached for duplicate identity (API-layer gate sufficient for demo).
- **Second identity:** not tested in E2E yet — competing bids demo deferred; single-worker multi-round flows (reject, reclaim) verified separately.

**2026-09-09 — self-custody change**

- Verify flow became two-step: connect wallet and sign the ownership challenge, then Selfie Check. IDKit stays disabled until the wallet is linked, so a proof is never consumed without somewhere to bind it.
- Worth noting for other integrators: binding the nullifier to a **user-held** address is strictly better than a custodial wallet keyed to the nullifier, and costs nothing in Selfie Check terms — the nullifier does the same eligibility work either way.

## Suggestions for World ID team

1. Clearer dashboard copy distinguishing **team API key** vs **RP signing key** vs **app_id** — easy to confuse during setup.
2. Document which `environment` value (`sandbox` vs `staging`) Selfie Check sandbox World App expects alongside legacy 3.0 proofs.
3. Selfie Check Beta flag status visibility in Developer Portal (pending vs enabled) would reduce integration uncertainty.
