# PLAN.md — Levantate Bridge build task list

Working checklist. Execute top to bottom; check items off as they complete. Standing rules live in
`AGENTS.md`; full architecture lives in `docs/spec.md`.

Conventions used here:

- `[ ]` pending · `[x]` done · `[~]` in progress · `[!]` blocked (note the blocker inline)
- **COMMIT** markers are the git commit points from `AGENTS.md`. Do not commit between them unless
the tree builds and the feature works.
- Tasks citing **D1**–**D6** implement a decision recorded in "Resolved decisions" below.

---

## Resolved decisions

Ambiguities in `docs/spec.md`, decided 2026-09-08. These are binding — build to them.

- **D1 — Auction resolution.** `postTask` stores a `bidDeadline` on-chain. `placeBid` reverts after
the deadline; `selectWinner` reverts before it. Any bid at or below `maxBudget` is eligible, and
the agent picks the winner by scoring each bid on price-versus-history and worker completion rate
pulled live from the subgraph — the contract does **not** force lowest-bid-wins. After the deadline
with zero bids, `cancelTask` refunds the full escrowed `maxBudget` to the agent.
- **D2 — Demo scenario.** The task is the spec's example: *"collect and summarize complaints from
residents in this neighborhood."* The worker submits free text plus an optional link; the backend
stores the content and only its `keccak256` hash goes on-chain as `proofRef`. The agent decides
`approveWork` by LLM-evaluating the submitted proof against the task description, so a rejection
path is required alongside approval. The demo runs two distinct sandbox World ID identities and at
least two competing bids.
- **D3 — Bid submission.** The backend acts as a trusted relayer: `placeBid` takes the worker address
as a parameter and is called by the backend's own wallet. Worker Circle Wallets are never gas-funded
and never sign — they exist purely to receive payment, which keeps the zero-wallet-burden property
the spec calls for.
- **D4 — Selfie Check gate.** Request access from `developers@toolsforhumanity.com` immediately (day
one — it has lead time). Build the complete IDKit flow against another preset in the meantime, so
that swapping in `selfieCheckLegacy()` touches only the preset call. The server-side verification,
nullifier storage, and duplicate-identity block are all real regardless of preset — nothing here is
mocked.

- **D5 — Submission deadline and reclaim.** `postTask` commits a `submissionWindow` duration.
`selectWinner` sets `submissionDeadline = block.timestamp + submissionWindow`; `submitWork` reverts
after it, so late work is impossible rather than ambiguous. `reclaimTask` is agent-only, requires
state `Assigned` and `block.timestamp > submissionDeadline`, and returns the task to `Open` with a
fresh `bidDeadline` for a new bidding round. It clears the assignment, increments a `round` counter,
and bars the defaulting worker from bidding again on that task. Escrow stays locked across the
reclaim — the task still needs doing at the same budget — and is only refunded by `cancelTask` if a
round closes with no bids. `rejectWork` also refreshes `submissionDeadline`, otherwise a rejection
landing near the deadline would leave no time to resubmit. Every reclaim emits `TaskReclaimed`, which
the subgraph indexes as a per-worker reputation signal.
- **D6 — Relayed transaction confirmation.** A transaction hash means *submitted*, never *succeeded*.
Every relayed transaction is persisted before submission with a UUID v4 idempotency key, moves to
`pending` once a hash comes back, and only reaches `confirmed` when its event surfaces in the
subgraph. Retries reuse the same idempotency key so Circle returns the original transaction instead
of double-submitting. All submissions from one wallet pass through a single-concurrency FIFO queue
(agent wallet and relayer wallet get separate queues) because concurrent sends from one EVM wallet
race on nonce assignment. "Event not indexed yet" is `pending`, not `failed`; only a timeout
escalates, and the RPC receipt is used to diagnose a genuine revert while the subgraph stays the
authority for declaring success.

Consequences worth noting: the relayer in D3 means the contract must trust one address to attribute
bids, so `placeBid` needs relayer-only access control and the demo narration should be honest that
bid attribution is backend-mediated. The LLM approval in D2 adds a rejection branch the contract
state machine must handle: `rejectWork` moves a `Submitted` task back to `Assigned` so the worker can
resubmit. No new terminal state and no extra refund path — the escrow stays locked until the work is
approved or the task is cancelled for having no bids.

D6 forces two things that were previously loose. First, **every state-transition function must emit
an event** — `submitWork`, `rejectWork`, `reclaimTask`, and `cancelTask` were all silent in the
earlier draft, which would have made them unconfirmable. The event set is now eight, not four.
Second, **the API can no longer answer synchronously** with "done": writes return a pending handle
and the client polls, so the frontend needs pending states on every action rather than only on
payment. D5 adds a `round` dimension to tasks and bids, which the subgraph schema must carry so
historical price analysis can distinguish a re-bid round from a first-round bid.

---



## Phase 0 — Repo and toolchain setup

- [x] Create the four top-level folders (`contracts`, `backend`, `frontend`, `subgraph`) per `AGENTS.md`
- [x] Add root `.gitignore` covering `node_modules`, `.env`, Foundry `out`/`cache`, Circle recovery file, subgraph `generated`/`build`
- [x] Install Foundry v1.8.0 via `foundryup`; confirm `forge --version` (installed v1.8.1)
- [x] `contracts/foundry.toml`: pin `solc = "0.8.36"`, set `evm_version` to Osaka, add `arc_testnet` RPC endpoint
- [x] Install forge-std v1.14.0 and OpenZeppelin Contracts 5.7.0 into `contracts`
- [x] Confirm Node ≥ 20.18.2 (required by Circle CLI) — v26.8.1
- [x] Add `.env.example` to `contracts`, `backend`, `frontend`, `subgraph` with empty values — root `.env.example` per AGENTS.md



## Phase 1 — Circle account and wallets

- [x] Create Circle developer account; obtain API key for testnet
- [x] Generate and register the entity secret; store the recovery file outside the repo
- [x] Install `@circle-fin/cli` (Agent Stack) and verify with `circle --version` — `npx @circle-fin/cli --version` → 1.0.0
- [x] Add `@circle-fin/developer-controlled-wallets@10.8.0` to `backend`
- [x] `backend`: initialize the Circle client via `initiateDeveloperControlledWalletsClient`
- [x] Create one wallet set; create the requesting agent's wallet on `ARC-TESTNET` — wallet set `a14db087-afb5-5c60-a7e4-59a80b79299d`, agent `d8d6ff69-5615-5a0c-8989-8ace4e7c2889` at `0x42472b448b6ba8bb654483d4773db715901a64a7`
- [x] Fund the agent wallet with testnet USDC from `faucet.circle.com`; confirm balance on `testnet.arcscan.app`
- [x] Verify a plain USDC ERC-20 `transfer` from the agent wallet via `createContractExecutionTransaction` against `0x3600...0000` — verified 0.1 USDC transfer on Arc testnet (tx `0x89e301dc535b5e5e111dc65c65b7bf9ec05026b9eb9d3faeb6d44c923cf6640e`)



## Phase 2 — Escrow contract

- [x] Write the `Task` struct and the state enum: `Open → Bidding → Assigned → Submitted → Paid`, plus a `Cancelled` terminal state for the D1 no-bids path
- [x] Add the D5 deadline fields to `Task`: `bidDeadline`, `submissionWindow` (duration), `submissionDeadline` (set at assignment), and a `round` counter
- [x] Declare all eight events — `TaskPosted`, `BidPlaced`, `WorkerAssigned`, `WorkSubmitted`, `WorkRejected`, `PaymentReleased`, `TaskReclaimed`, `TaskCancelled` — with every field the subgraph entities and the D6 confirmation tracker need, including `taskId`, `round`, and the acting worker where applicable. Changing these later means a redeploy and full reindex, so get them right up front
- [x] Implement `postTask(description, maxBudget, bidDeadline, submissionWindow)`: pulls `maxBudget` USDC via ERC-20 `transferFrom` (6 decimals) into escrow, stores both deadline parameters, emits `TaskPosted`
- [x] Implement `placeBid(taskId, worker, amount)`: relayer-only per D3, reverts past `bidDeadline`, reverts if `amount > maxBudget`, reverts if the worker was barred by a prior reclaim, emits `BidPlaced` with the current `round`
- [x] Implement `selectWinner(taskId, bidId)`: agent-only, reverts before `bidDeadline`, sets `Assigned`, sets `submissionDeadline = block.timestamp + submissionWindow`, emits `WorkerAssigned` including the resulting deadline
- [x] Implement `submitWork(taskId, proofHash)`: assigned-worker-only, takes a `bytes32` keccak256 hash per D2, reverts past `submissionDeadline` per D5, sets `Submitted`, emits `WorkSubmitted`
- [x] Implement `approveWork(taskId)`: agent-only, releases the winning bid amount to the worker via ERC-20 `transfer`, refunds `maxBudget - bid` to the agent, sets `Paid`, emits `PaymentReleased`
- [x] Implement `rejectWork(taskId)` per D2: agent-only, returns the task to `Assigned` for resubmission, **refreshes `submissionDeadline`** per D5, emits `WorkRejected`
- [x] Implement `reclaimTask(taskId, newBidDeadline)` per D5: agent-only, requires `Assigned` and `block.timestamp > submissionDeadline`, clears the assignment, increments `round`, bars the defaulting worker from re-bidding this task, returns state to `Open` with the new bid deadline, keeps escrow locked, emits `TaskReclaimed`
- [x] Implement `cancelTask(taskId)` per D1: callable after `bidDeadline` with zero bids in the current round, refunds the full `maxBudget` to the agent, sets `Cancelled`, emits `TaskCancelled`
- [x] Add access-control modifiers (agent-only, relayer-only, assigned-worker-only) and state-transition guards
- [x] Forge tests for the happy path across all states
- [x] Forge tests for the revert cases: bid over budget, bid after `bidDeadline`, `selectWinner` before `bidDeadline`, `submitWork` after `submissionDeadline`, `reclaimTask` before `submissionDeadline`, `reclaimTask` on a `Submitted` task, barred worker re-bidding, wrong-state calls, non-agent calling `selectWinner`/`approveWork`/`reclaimTask`, non-relayer calling `placeBid`, double-approve
- [x] Forge tests for `rejectWork` → resubmit → approve, and that `rejectWork` actually extends `submissionDeadline`
- [x] Forge tests for the full reclaim cycle: assign → miss deadline → reclaim → re-bid in round 2 → assign → submit → approve, asserting escrow was never released to the defaulting worker
- [x] Forge test that `cancelTask` refunds exactly `maxBudget`, including after a reclaim
- [x] Forge test asserting every state-transition function emits its event (D6 depends on this — a silent transition is an unconfirmable one)
- [x] Write the deploy script; deploy to Arc testnet at chain ID 5042002 — deployed via `contracts/script/deploy.sh`
- [x] Record deployed address, deploy block number, and ABI where `backend`, `frontend`, and `subgraph` can each consume them — ABI at `contracts/abi/TaskEscrow.json`; address/block in `.env.local` and `contracts/deployments/arc-testnet.json` (`0xfb4de5a78d8085132f454cc96efd958e55a96a52`, block `0x3a4d280`)
- [x] Manually exercise `postTask` → `placeBid` → `selectWinner` → `submitWork` → `approveWork` on Arc testnet via `cast`, confirming the USDC balance actually moved — task 1 paid 0.8 USDC to worker `0x579Af55b4d9152F87bfb39F87466BeA0E78DfC61`
- [x] Manually exercise the reclaim path on Arc testnet with a short `submissionWindow`, confirming the task returns to `Open` and escrow is still held — task 2 reclaimed to round 1, escrow held 1.5 USDC (includes task 0 still in `Submitted`)
- [x] **COMMIT 1** — escrow contract deployed to Arc testnet (including `submissionDeadline` and `reclaimTask`) — landed in `84e26ce`



## Phase 3 — World ID Selfie Check

- [x] Register the app in the World ID Developer Portal; obtain `rp_id` and RP signing key
- [ ] **Do this first:** request Selfie Check (Beta) access from `developers@toolsforhumanity.com` — tracked in `docs/selfie-check-feedback.md`
- [ ] Get sandbox access; install the sandbox World App build via TestFlight or the private Play track
- [x] Add `@worldcoin/idkit@4.2.1` to `frontend`
- [x] `backend`: RP signature endpoint that signs the action with the signing key and returns `rp_context` — `POST /api/world-id/rp-signature`
- [x] `frontend`: fetch `rp_context`, then open IDKit with `environment: sandbox`, `allow_legacy_proofs: true`, and the bid context as `signal`. Isolate the preset call behind a single named export so the D4 swap to `selfieCheckLegacy()` is a one-line change — `frontend/lib/world-id-preset.ts`, page at `/verify`
- [ ] Once the Selfie Check flag is granted, swap the preset to `selfieCheckLegacy()` and re-run the full verification flow
- [x] `backend`: proof verification endpoint that forwards the complete IDKit result unmodified to `POST https://developer.world.org/api/v4/verify/{rp_id}` — `POST /api/world-id/verify`
- [x] `backend`: enforce that the `signal` matches the value the server expects for this bid — signal token + TTL map
- [x] Persist the nullifier hash and reject a second distinct worker identity presenting a known nullifier — `backend/data/workers.json` (gitignored)
- [x] Create the worker's Circle Wallet on `ARC-TESTNET` on first successful verification, keyed to the nullifier
- [ ] **COMMIT 2** — Circle wallet creation (agent + worker) working (worker wallets land here because creation is triggered by verification) — agent done in Phase 1; worker path coded, pending live World ID proof
- [ ] Verify the duplicate-identity block end-to-end in sandbox: same World ID, second worker account, bid rejected
- [x] Start `docs/selfie-check-feedback.md` and log friction as it is encountered (sandbox install, access gate, 3.0-only preset, error messages) — write this while it's fresh, not at the end
- [ ] **COMMIT 3** — World ID Selfie Check verification working end-to-end



## Phase 4 — Backend marketplace API

- [x] `backend`: viem client on `arcTestnet` from `viem/chains`, pinned `viem@2.56.0`
- [x] Typed contract bindings from the deployed ABI — `backend/abi/TaskEscrow.json`, `src/chain/escrow.ts`
- [x] Persistence for workers (nullifier → Circle wallet ID and address), tasks, bids, and task rounds — `backend/data/db.json` (gitignored)

### Relayer submission queue (D6)

- [x] Create and fund the backend relayer wallet with gas USDC; store its address for the contract's relayer role — `77388e4f-d917-59ef-8ada-ca1966c712d3` at `0xd055b6cee7d72bc5111119ec7beb8c56b2f61ae1`
- [x] `relayed_transactions` table: idempotency key (UUID v4), kind, task id, round, worker, wallet, tx hash, status (`queued` → `submitted` → `confirmed` | `failed`), expected event, timestamps — in `db.json`
- [x] Persist the row **with its idempotency key before submitting**, so a crash between submit and record cannot orphan a transaction
- [x] Single-concurrency FIFO queue per wallet (agent wallet and relayer wallet queued separately); dequeue the next submission only once the previous one has returned a hash and its nonce is assigned — `src/relayer/queue.ts`
- [x] Pass the stored idempotency key on every submission, and reuse the same key on retry so Circle returns the original transaction rather than double-submitting
- [x] Verify at integration time whether the sandbox accepts `idempotencyKey` in the request body (see the note in `AGENTS.md`); if rejected, fall back to the SDK's supported placement rather than dropping idempotency — accepted; `postTask`/`cancelTask` submissions succeeded with UUID keys
- [ ] Periodic resync of the relayer's on-chain nonce to detect gaps or drift, per Circle's guidance
- [ ] Load-test the queue: fire concurrent bid requests from several workers at once and confirm every transaction lands with sequential nonces and none are lost to a nonce collision
- [x] Escrow redeployed with Circle agent (`0x42472…`) and relayer (`0xd055b6…`) at `0x4f75bea0a2d3a8e494161f115ecdcb9f18175806`

### Marketplace endpoints

- [x] `POST /api/tasks` — agent posts a task: Circle `approve` on USDC then `postTask`, passing `bidDeadline` and `submissionWindow`
- [x] `GET /api/tasks` — list open tasks for the worker frontend, including current round and both deadlines
- [x] `POST /api/tasks/:id/select` — agent selects the winning bid on-chain
- [x] `POST /api/tasks/:id/submit` — assigned worker submits proof text; backend stores the content and enqueues its keccak256 hash on-chain
- [x] `GET /api/tasks/:id/proof` — returns the stored proof content and lets a verifier recompute the hash against the on-chain value
- [x] `POST /api/tasks/:id/approve` — triggers `approveWork`, releasing USDC to the worker's Circle wallet
- [x] `POST /api/tasks/:id/reject` — triggers `rejectWork`, returning the task for resubmission
- [x] `POST /api/tasks/:id/reclaim` — triggers `reclaimTask` for an assigned task past its `submissionDeadline`
- [x] `POST /api/tasks/:id/cancel` — triggers `cancelTask` for a round that closed with no bids — verified on task 1 (tx `0xcf4c2abe…`)
- [x] `GET /api/tasks/:id/bids` — list bids for a task round
- [x] Every write returns a **pending handle** (relayed transaction id, status, tx hash) — never a bare success. `GET /api/transactions/:id` exposes current status for polling
- [x] Reject invalid state transitions at the API layer with clear errors, not just on-chain reverts
- [ ] Confirm a real payout landed in the worker's Circle wallet and the balance is visible via the Circle API — pending full bid→select→submit→approve flow with verified worker
- [ ] **COMMIT 4** — relayer submission queue working (serialized nonces, idempotent retries)
- [ ] **COMMIT 5** — backend payment/escrow release logic working



## Phase 5 — Subgraph

- [x] Create the subgraph in Subgraph Studio; save the deploy key
- [x] `subgraph/subgraph.yaml`: network `arc-testnet`, escrow address, start block = deploy block — `0x4f75bea0…5806`, block `61137121`
- [x] `subgraph/schema.graphql`: `Task`, `Bid`, `Worker`, `Payment`, `MissedDeadline` entities with the relations the agent will need to query
- [x] Every entity stores `transactionHash` and `blockTimestamp` so the D6 tracker can correlate an indexed event back to the submission that produced it
- [x] `Task` and `Bid` carry `round` so re-bid rounds are distinguishable from first-round bids in price analysis
- [x] Add `@graphprotocol/graph-cli@0.98.1` and `@graphprotocol/graph-ts@0.38.2`; run `graph codegen`
- [x] Mapping handler for `TaskPosted` → `Task`
- [x] Mapping handler for `BidPlaced` → `Bid`, linked to `Task` and `Worker`
- [x] Mapping handler for `WorkerAssigned` → updates `Task` with worker and `submissionDeadline`, upserts `Worker`
- [x] Mapping handler for `WorkSubmitted` → updates `Task` state and records the proof hash
- [x] Mapping handler for `WorkRejected` → updates `Task` state and the refreshed `submissionDeadline`
- [x] Mapping handler for `PaymentReleased` → `Payment`, increments the worker's completed-task counters
- [x] Mapping handler for `TaskReclaimed` → `MissedDeadline` record, increments that worker's missed-deadline counter, resets `Task` to open at the new round
- [x] Mapping handler for `TaskCancelled` → marks `Task` terminal
- [x] Maintain derived worker reputation fields the agent needs: tasks assigned, tasks paid, **missed deadlines**, completion rate
- [x] `graph auth` then `graph deploy` to Studio — deployed `v0.0.3` to slug `levantate-bridge` (adds immutable `EscrowEvent` for D6 hash correlation)
- [x] Confirm in the Studio playground that **all eight** event types indexed and no mapping errors are logged — `TaskPosted` + `TaskCancelled` indexed for on-chain tasks 0–1; `hasIndexingErrors: false`
- [ ] Generate historical data: post and complete several tasks at varying prices so the agent has a real distribution to reason over — a subgraph with one task in it can't inform a budget
- [ ] Generate at least one real missed-deadline reclaim in the history so the agent's penalty logic has something to act on
- [x] **COMMIT 6** — subgraph deployed and returning indexed data

## Phase 6 — Transaction confirmation tracker (D6)

Depends on Phase 5 — the subgraph must be live and indexing before it can be the source of truth.

- [x] Reconciler that polls the subgraph for the expected event of each `submitted` relayed transaction, matching on `transactionHash` via `EscrowEvent`
- [x] On match, mark `confirmed` and advance the backend's task state; on no match, leave `pending` — "not indexed yet" is never `failed`
- [x] Timeout escalation: after a bounded wait, fetch the RPC receipt to distinguish a reverted transaction from indexing lag, mark `failed` only on a confirmed revert, and record the revert reason
- [x] Recovery on startup: re-reconcile any transaction left `submitted` from a previous process so a restart cannot lose track of in-flight work
- [x] `GET /transactions/:id` returns live status; ensure no endpoint anywhere reports success without a `confirmed` row
- [x] Verify a reverted relayed transaction is correctly surfaced as failed rather than silently treated as success — over-budget `placeBid` rejected by Circle / marked `failed`
- [x] Verify a confirmed transaction is only marked confirmed after the subgraph shows it, not when the hash returned — 6 historical `submitted` rows confirmed via `EscrowEvent` lookup on v0.0.3
- [x] **COMMIT 7** — transaction confirmation tracker working (pending → confirmed driven by subgraph events)



## Phase 7 — Agent decision logic

- [ ] `backend`: GraphQL client against the Studio dev query URL
- [ ] Query: historical paid amounts for comparable tasks
- [ ] Query: per-worker assigned vs. paid counts for completion rate
- [ ] Query: per-worker missed-deadline count from `MissedDeadline` records
- [ ] Budget setting: derive `maxBudget` from the historical distribution rather than a constant
- [ ] Choose `submissionWindow` per task from history rather than a constant — how long comparable tasks actually took to deliver
- [ ] Bid evaluation: score every bid at or below `maxBudget` on price-versus-history, worker completion rate, and missed-deadline history; pick the best score
- [ ] Log the agent's reasoning (the numbers it pulled, the score per bid, why the winner won) — the demo needs to show reasoning over live data, not a query dump
- [ ] Add the LLM client for proof evaluation (pin the version in `AGENTS.md`; API key via env, never committed)
- [ ] Proof evaluation: send the task description and submitted proof to the LLM, get an approve/reject verdict with a reason, then call `approveWork` or `rejectWork` accordingly
- [ ] Verify the reject path end-to-end: submit deliberately inadequate proof, confirm the agent rejects it and the task returns to `Assigned` with a refreshed deadline
- [ ] Agent watches for assigned tasks past `submissionDeadline` and calls `reclaimTask` autonomously — the reclaim is an agent decision, not a manual demo step
- [ ] Verify the selection changes appropriately when subgraph history changes (e.g. a worker with a poor completion rate or a prior missed deadline is passed over despite bidding lower)
- [ ] **COMMIT 8** — agent decision logic working



## Phase 8 — Worker frontend

- [ ] `frontend`: Next.js 16.3.4 on React 19, pinned
- [ ] Task browse view listing open tasks with budget and time remaining
- [ ] Selfie Check gate: IDKit flow, blocking bid submission until verification succeeds
- [ ] Bid form with client-side `maxBudget` validation and remaining-time display from `bidDeadline`
- [ ] Assigned-task view with the proof submission form (free text plus optional link) and a visible **countdown to `submissionDeadline`**
- [ ] Pending-transaction UI per D6: every action shows submitted-but-unconfirmed state, polls `GET /transactions/:id`, and only reports success once confirmed. No optimistic success anywhere
- [ ] Show rejection feedback and allow resubmission when the agent rejects the proof
- [ ] Show the reclaimed state when a worker loses a task to a missed deadline, and reflect that they are barred from re-bidding that task
- [ ] Payment status view showing the worker's Circle wallet balance and the settlement transaction link
- [ ] Surface backend errors visibly (rejected duplicate nullifier, bid over budget, closed auction, expired submission window, failed relayed transaction)
- [ ] Minimal styling — functional over polished, per spec
- [ ] **COMMIT 9** — frontend task browse/bid/submit flow working



## Phase 9 — End-to-end and deliverables

- [ ] Dedicated reclaim run: post a task with a deliberately short `submissionWindow`, let the assigned worker miss it, confirm the agent reclaims autonomously, a second worker wins round 2, and payment settles to the second worker
- [ ] Confirm the `MissedDeadline` record is indexed and the first worker's reputation reflects it
- [ ] **COMMIT 10** — missed-deadline reclaim path verified end-to-end
- [ ] Full flow on real testnets with two distinct sandbox World ID identities and at least two competing bids
- [ ] Confirm the duplicate-identity block fires during the end-to-end run, not just in isolation
- [ ] Confirm the agent's winner choice is traceable to specific subgraph numbers
- [ ] Confirm USDC actually moved: agent wallet debited, worker wallet credited, unspent budget refunded
- [ ] Confirm no relayed transaction was ever reported successful before its event was indexed
- [ ] Fix breakage found in the run
- [ ] Sweep for dead code and unused dependencies introduced during integration; delete
- [ ] **COMMIT 11** — full end-to-end flow verified working
- [ ] `docs/`: architecture diagram with explicit sponsor-product labels on each leg of the flow, including the reclaim path and the subgraph-as-confirmation-layer role
- [ ] `README.md`: setup, env vars, run instructions, and the sponsor-product mapping table
- [ ] Finalize `docs/selfie-check-feedback.md` from the notes kept during Phase 3
- [ ] Record the demo video, narrating which sponsor product powers each step
- [ ] **COMMIT 12** — diagram, README, and docs added