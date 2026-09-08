# Selfie Check integration feedback

Log friction while building and testing World ID / Selfie Check. Update this file as issues are hit — not at the end of the project.

## Access gate

- **Status:** Not yet requested (or pending) — email `developers@toolsforhumanity.com` for Selfie Check Beta flag.
- **Interim preset:** `orbLegacy` in `frontend/lib/world-id-preset.ts` so IDKit flow is complete before the flag lands. One-line swap to `selfieCheckLegacy()` when granted.

## Sandbox World App

- Install sandbox build via Developer Portal TestFlight / Play track before end-to-end proof on device.

## Environment

- `environment: sandbox` in IDKit; `allow_legacy_proofs: true` for 3.0 presets.
- RP signature required (`rp_context`) even for legacy presets — backend signs via `@worldcoin/idkit-core/signing`.

## Notes

_(Add dated entries as you test.)_

- 2026-09-09 — Phase 3 scaffold: backend `/api/world-id/rp-signature` + `/api/world-id/verify`, frontend `/verify` with `orbLegacy`. Full device flow pending sandbox World App + Selfie Check flag.
