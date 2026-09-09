# AGENTS.md — Levantate Bridge standing operational rules

Full architecture, sponsor mapping rationale, and demo requirements: `docs/spec.md`.
Current task list and build order: `PLAN.md` (update it as work completes). Its "Resolved
decisions" section is binding — auction resolution, the demo scenario and proof format,
bid-submission authority, the Selfie Check access gate, task submission deadlines and reclaim, and
relayed-transaction confirmation. Read it before writing contract, backend, or agent code.

This file holds only the rules that apply to *every* task. Do not duplicate spec or plan content here.

---

## Repo structure

Keep a clean top-level split. Do not mix concerns into shared folders.

```
/contracts     — Solidity escrow contract, deployment scripts, Arc testnet config
/backend       — marketplace API, Circle SDK integration, World ID verification, chain calls, Supabase schema
/frontend      — worker-facing web app
/subgraph      — schema.graphql, mappings, subgraph manifest for Subgraph Studio
/docs          — spec, architecture diagram, README content, Selfie Check feedback doc
```

Each folder is independently runnable/buildable with its own `package.json` (or `foundry.toml`). No
monolithic app mixing contract code, API routes, and frontend components. No root-level workspace
that blurs the boundary — if `/backend` and `/frontend` need to share a type or an ABI, copy the
generated artifact rather than introducing a shared package.

## Sponsor-product mapping

Every sponsor integration must be visibly doing real work and labeled as such in the README,
architecture diagram, and demo narration. When touching any of these areas, preserve the mapping:


| Sponsor                                  | What it must be observably doing                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Circle** (Agent Stack / Wallets / Arc) | Agent holds a Developer-Controlled Wallet that funds escrow in USDC. A second Developer-Controlled Wallet acts as the relayer that submits worker transactions so workers never need gas. Escrow contract is deployed **on Arc**, USDC as native gas/settlement asset. `approveWork` → `releasePayment` is an autonomous on-chain USDC settlement triggered by the agent, paid to the worker's **self-custodied** address. |
| **World ID** (Selfie Check)              | **Every bid carries its own fresh Selfie Check proof**, bound by `signal` to that task, round, and amount, verified server-side and spendable once. The bidder's identity is derived from the proof, never from a client-supplied value. A one-time registration binds the nullifier to a self-custodied payout address, blocking one person bidding under multiple identities. Framing is **economic-participation eligibility gating**, not identity verification. |
| **The Graph** (Subgraph Studio)          | Subgraph indexes every contract state transition (`TaskPosted`, `BidPlaced`, `WorkerAssigned`, `WorkSubmitted`, `WorkRejected`, `PaymentReleased`, `TaskReclaimed`, `TaskCancelled`). The agent **queries the subgraph live** to set budgets and pick winning bids from real historical signals, including missed-deadline history. It is also the **confirmation authority** for whether a relayed transaction landed. Must be reasoning over live on-chain data, not a raw query printout.        |


Single settlement rail throughout: USDC on Arc via Circle. No cross-chain bridging or swapping
anywhere in the flow.

## Hard rules

- **No mocked endpoints.** Every external integration (Circle, World ID, The Graph) hits real
testnet/sandbox endpoints. No hardcoded fake responses, fixture files, or stub clients standing in
for an actual call. If an integration can't be reached, stop and report it — do not fake it.
- **No dead code.** If a function, route, contract method, event, or import stops being used after a
refactor, delete it in the same change. No commented-out code left behind.
- **No speculative scaffolding.** No unused abstractions, placeholder functions, config options
nothing reads, or interfaces with one implementation. Build only what `PLAN.md` calls for.
- **Verify current APIs via web search when unsure.** Do not guess or recall API surface for Circle
Agent Stack / Wallets SDK method names, World ID IDKit/MiniKit signatures, Arc RPC and chain
details, or Subgraph Studio deployment steps. Check current docs before writing dependent code.
Training data on all four is stale.
- **Pin verified versions.** Every dependency version in `package.json` / `foundry.toml` must be an
exact pin traced to the table below (or a newer version you verified by search). Never default to a
version from memory.
- **One working path over broad partial coverage.** A fully working demo of Circle + Selfie Check +
Graph in one clean flow beats several half-finished features.
- **A transaction hash is not a success.** Never report a write as succeeded because a hash came
back — a submitted transaction can still revert, be dropped, or be superseded. Every relayed
transaction stays `pending` until its event appears in the subgraph, which is the single source of
truth for "this happened on-chain." This applies to API responses, frontend state, agent logic, and
demo narration alike.
- **Every state-transition function emits an event.** No silent transitions in the contract. If a
transition emits nothing, the confirmation tracker cannot observe it and the subgraph's picture of
task state is incomplete.
- **Serialize relayer submissions.** One relayer wallet submits for many workers concurrently, and
EVM nonces must be sequential with no gaps. All submissions from a given wallet go through a
single-concurrency queue with an idempotency key. Never fire relayed transactions in parallel from
one wallet.



## Verified dependency versions

Verified by web search on **2026-09-08**. Re-verify before adding anything not listed.


| Dependency                                 | Pinned version | Notes                                                                                                                                                |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solidity                                   | `0.8.36`       | Released 2026-07-09. Pin exactly in pragma, not a range.                                                                                             |
| Foundry                                    | `v1.8.0`       | Released 2026-08-26. `--isolate` and dynamic test linking are now defaults. `@foundry-rs/*` npm packages are discontinued — install via `foundryup`. |
| forge-std                                  | `v1.14.0`      | Requires Solidity `^0.8.13`.                                                                                                                         |
| OpenZeppelin Contracts                     | `5.7.0`        | Released 2026-07-29 (audited `latest` tag).                                                                                                          |
| `@circle-fin/developer-controlled-wallets` | `10.8.0`       | Released 2026-07-01.                                                                                                                                 |
| `@circle-fin/cli` (Agent Stack)            | latest         | Agent Stack ships as a CLI, not an SDK package. Requires Node ≥ 20.18.2.                                                                             |
| `@worldcoin/idkit`                         | `4.2.1`        | React SDK. Depends on `@worldcoin/idkit-core` `4.2.2`.                                                                                               |
| `@graphprotocol/graph-cli`                 | `0.98.1`       | Defaults to the Rust `gnd` binary; `GRAPH_CLI_IGNORE_GND` falls back to TypeScript.                                                                  |
| `@graphprotocol/graph-ts`                  | `0.38.2`       | AssemblyScript mapping library.                                                                                                                      |
| Next.js                                    | `16.3.4`       | Released 2026-08-31. Runs on React 19.                                                                                                               |
| `@rainbow-me/rainbowkit`                   | `2.2.11`       | Verified 2026-09-09. Peer: wagmi `^2.9.0` (do **not** install wagmi 3).                                                                              |
| wagmi                                      | `2.19.5`       | Last 2.x line RainbowKit 2.2.11 accepts.                                                                                                             |
| `@tanstack/react-query`                    | `5.102.8`      | RainbowKit / wagmi peer.                                                                                                                             |
| viem                                       | `2.56.0`       | Ships `arcTestnet` as a built-in chain — `import { arcTestnet } from 'viem/chains'`. Requires TypeScript ≥ 5.9.                                      |
| ethers                                     | `6.17.0`       | Only if something specifically needs it; viem is the default for this repo.                                                                          |
| `@supabase/supabase-js`                    | `2.115.0`      | Verified 2026-09-09. Backend persistence. **Requires Node ≥ 22** — Node 20 support was dropped in 2.110.0.                                           |
| `@anthropic-ai/sdk`                        | `0.123.0`      | Released 2026-09-01. For the agent's proof evaluation. Requires Node ≥ 20.                                                                           |
| `openai`                                   | `7.10.0`       | Released 2026-09-03. Alternative to the above — pick one, not both. Requires Node ≥ 22.                                                              |
| Tailwind CSS                               | `4.3.3`        | Verified 2026-09-10. Use `@tailwindcss/postcss` `4.3.3` with Next; no `tailwind.config.js`.                                                          |
| `motion`                                   | `13.2.0`       | Verified 2026-09-10. Import from `motion/react`.                                                                                                     |
| `lucide-react`                             | `1.43.0`       | Verified 2026-09-10.                                                                                                                                 |
| `clsx`                                     | `2.1.1`        | Classname helper for the worker UI.                                                                                                                  |
| `tailwind-merge`                           | `3.6.0`        | Used by `cn()`.                                                                                                                                      |


**Do not use** `@worldcoin/minikit-js` **for verification.** MiniKit 2.x removed World ID verification
entirely; `MiniKit.verify` and `MiniKit.commandsAsync.verify` are gone. All World ID work goes
through `@worldcoin/idkit`. MiniKit is only relevant if the frontend is run as a World App mini app.

## Verified network and integration facts

Also verified 2026-09-08. These are the values to use — do not substitute remembered ones.

**Arc Testnet**

- Chain ID `5042002` (`0x4CEF52`), CAIP `eip155:5042002`
- RPC `https://rpc.testnet.arc.io`, WebSocket `wss://rpc.testnet.arc.io`
- Explorer `https://testnet.arcscan.app`, faucet `faucet.circle.com` (10 USDC/hr per chain)
- Native gas token is USDC. **Two interfaces over one balance:** native uses 18 decimals
(`msg.value`, `addr.balance`), ERC-20 uses 6 decimals. Never mix raw values without converting.
- USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`. There is no wrapper contract.
Arc docs recommend relying solely on the ERC-20 interface for balances and transfers — this repo
does that, so escrow amounts are 6-decimal.
- EVM target is the **Osaka** hard fork — set `evm_version` accordingly, do not leave it on the
toolchain default.
- Deterministic BFT finality, sub-second blocks, 1 confirmation is final.
- `anvil` runs a standard EVM and **cannot** reproduce Arc behavior (native-coin precompiles,
EIP-7708 `Transfer` events, USDC blocklist). Anything Arc-specific must be tested against the real RPC.

**Circle**

- `ARC-TESTNET` is a supported blockchain for developer-controlled wallets (EOA and SCA).
- Client: `initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })`.
- Wallet creation: `client.createWalletSet(...)` then `client.createWallets({ blockchains: ["ARC-TESTNET"], count, walletSetId })`.
- Contract calls: `client.createContractExecutionTransaction({ walletId, contractAddress, abiFunctionSignature, abiParameters, fee: { type: "level", config: { feeLevel } } })`.
- Entity secret must be registered before API calls succeed; keep the recovery file out of git.
- **Nonce management is your problem, not Circle's.** Circle's own docs state that creating many
transactions at once from a single EVM wallet causes a nonce race: threads read the same current
nonce, several transactions get the same number, only the first succeeds and the rest fail. Circle's
recommended fix is a central lock or queue that assigns each nonce exactly once, plus periodic
resync against on-chain nonce state to detect gaps. Implement the queue; do not assume the SDK
serializes for you.
- `idempotencyKey` is a **UUID v4** and gives exactly-once execution: reusing a key returns the
original response instead of re-executing. Reuse the same key on every retry of a given logical
submission. (There are third-party reports of the sandbox rejecting this field in the request body
despite the SDK's types accepting it — verify behavior at integration time rather than assuming.)
- If relayer throughput ever becomes the bottleneck, SCA wallets support 2D nonces via a `nonceKey`
for parallel independent execution. Not needed at demo scale — the serialized queue is simpler and
correct.

**World ID**

- Selfie Check is **Beta and access-gated** — the app's feature flag must be enabled by request to
`developers@toolsforhumanity.com`. Without it the preset will not work.
- **`rp_context` is mandatory.** IDKit 4.x refuses to open the widget without a valid, backend-signed
`rp_context`, and this applies to legacy presets too — `selfieCheckLegacy` is no exception. There is
no `app_id`-only path anymore; that was the World ID 3.0 behavior the RP-signature design exists to
kill. So `rp_id` and `signing_key` are hard prerequisites for any verification work.
- Three distinct World ID values, easy to confuse:
  - `app_id` (`app_...`) — public app identifier, safe on the client.
  - `rp_id` (`rp_...`) — public relying-party identifier, safe on the client, used in the verify URL.
  - `signing_key` — **server-only secret**, signs `rp_context`. Returned exactly once at RP
    registration and unrecoverable; rotating it invalidates the previous signer.
- A Developer Portal **team API key is none of the above.** It authenticates the Developer Portal
management API/MCP (creating apps, configuring World ID, minting an RP) and cannot be used to sign
`rp_context` or verify a proof. Having it does not unblock verification — but it *is* what you use to
mint the RP and obtain `rp_id` + `signing_key` without touching the dashboard.
- Never generate RP signatures client-side, never ship the signing key to the browser, and never
print it to chat or logs — write it straight to the secret store.
- `environment` values are not interchangeable: `staging` targets the simulator, `sandbox` targets the
sandbox World App build. Confirm which one the Selfie Check sandbox flow expects at integration time
rather than assuming they are aliases.
- Preset is `selfieCheckLegacy()`, which currently uses **World ID 3.0**; 4.0 support is not yet
available for Selfie Check. Pass `allow_legacy_proofs: true`.
- Verify server-side with `POST https://developer.world.org/api/v4/verify/{rp_id}` (this endpoint
verifies both 4.0 and legacy 3.0 proofs). Domain is `world.org`, not `worldcoin.org`. The v1
endpoint is legacy — do not use it.
- Forward the complete IDKit result **as-is**. Do not remap response identifiers or construct a
`verification_level` by hand.
- Credential identifier is `selfie` (`face` is a backward-compatible alias).
- Sandbox: set `environment: sandbox` in IDKit config, and install the sandbox World App build via
the TestFlight / private Google Play track linked in the Developer Portal. Sandbox proofs are
non-production.
- Selfie Check is medium/low-assurance — it adds friction against automated and repeated account
creation but does **not** guarantee one-person-one-account. Describe it accurately in the README;
don't overclaim sybil resistance.

**The Graph**

- Arc Testnet is a supported network. Manifest network identifier is `arc-testnet`.
- Flow: create the subgraph in Studio → `graph auth <DEPLOY_KEY>` → `graph deploy <SLUG>`.
- Deploying to Studio is not publishing. Studio deployment plus the dev query URL is sufficient here.
- Indexing lag is real and independent of chain finality. Arc finalizes in one sub-second block, but
the subgraph still needs to index it. The confirmation tracker must therefore treat "event not found
yet" as *pending*, not *failed*, and only escalate after a timeout. To distinguish a genuinely
reverted transaction from one that simply is not indexed yet, fall back to the RPC receipt for
diagnosis — but keep the subgraph as the authority for declaring success.
- Entities must store `transactionHash` so the backend can correlate an indexed event back to the
submission that produced it.



## Git commit conventions

Commit after each meaningfully complete feature. Not one giant commit at the end, and never
mid-broken-state — the tree must build and the feature must work at every commit.

Each commit message names the feature and confirms it was tested. Describe behavior, not files.

- Good: `Add escrow release logic — tested payout to worker wallet on Arc testnet`
- Bad: `update contracts and backend`

Planned commit points (see `PLAN.md` for which tasks roll up into each):

1. Escrow contract written and deployed to Arc testnet (including `submissionDeadline` and `reclaimTask`)
2. Circle wallet creation (agent + relayer) working
3. World ID Selfie Check verification working end-to-end
4. Relayer submission queue working (serialized nonces, idempotent retries)
5. Backend payment/escrow release logic working
6. Subgraph deployed and returning indexed data
7. Transaction confirmation tracker working (pending → confirmed driven by subgraph events)
8. Agent decision logic (subgraph-informed bid selection, missed deadlines penalized) working
9. Frontend task browse/bid/submit flow working
10. Missed-deadline reclaim path verified end-to-end
11. Full end-to-end flow verified working
12. Diagram, README, and docs added



## Secrets and environment

All secrets live in a single gitignored **`.env.local` at the repo root**; each package reads from it
rather than keeping its own copy. Keep a committed `.env.example` at the root listing every key below
with empty values. Never commit real values, and never print a secret to chat, logs, or a commit
message.

Never commit: Circle API key, Circle entity secret or its recovery file, deployer private key, World
ID RP signing key, World ID team API key, Graph deploy key, LLM API key, Supabase service role key.

**Worker funds are never custodial.** The backend holds Circle Developer-Controlled Wallets for the
agent and the relayer only. Workers link a wallet they already control by signing an off-chain
challenge, and escrow pays that address directly. Never reintroduce a backend-held worker wallet, a
backend-initiated worker withdrawal, or any code path where a leaked backend credential can move a
worker's earnings.

Environment inventory — keep this current as values are obtained:

| Key | Phase needed | Status |
| --- | --- | --- |
| `CIRCLE_API_KEY` | 1 | present |
| `CIRCLE_ENTITY_SECRET` | 1 | present |
| `WORLD_DEVELOPER_API_KEY` | 3 (portal/MCP only) | present |
| `GRAPH_AUTH_DEPLOY_KEY` | 5 | present |
| `WORLD_APP_ID` | 3 | present |
| `WORLD_RP_ID` | 3 | present |
| `WORLD_SIGNING_KEY` | 3 | present (server-only; note the name has no `RP_` infix) |
| `WORLD_ID_ACTION` | 3 | pending (chosen when the action is created) |
| `ARC_RPC_URL` | 2 | public — `https://rpc.testnet.arc.io` |
| `DEPLOYER_PRIVATE_KEY` | 2 (deploy only) | present — **fund deployer on Arc testnet** |
| `ESCROW_CONTRACT_ADDRESS` | 4, 5 | produced by Phase 2 deploy |
| `ESCROW_DEPLOY_BLOCK` | 5 | produced by Phase 2 deploy |
| `CIRCLE_WALLET_SET_ID` | 1 | produced by Phase 1 |
| `CIRCLE_AGENT_WALLET_ID` | 4 | produced by Phase 1 |
| `CIRCLE_RELAYER_WALLET_ID` | 4 | produced by Phase 4 |
| `SUBGRAPH_QUERY_URL` | 6, 7 | produced by Phase 5 deploy |
| `SUPABASE_URL` | 4 | pending — created with the hosted Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | 4 | pending — **server-only**, bypasses RLS |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | 8 | pending — public WalletConnect Cloud / Reown id for RainbowKit |
| `ANTHROPIC_API_KEY` *or* `OPENAI_API_KEY` | 7 | present (`OPENAI_API_KEY`, D2 proof evaluation) |