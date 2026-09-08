# Levantate Bridge — Agent-to-Human Task Marketplace with Verified Workers and On-Chain Settlement

## One-line pitch

When an AI agent hits a task it can't complete alone, it posts it to a marketplace where verified humans bid to do it — and get paid in USDC on Arc the moment the work is approved.

## Problem

Autonomous agents increasingly handle real workflows (data collection, paperwork, moderation, physical verification), but regularly hit tasks that genuinely require a human: something offline/physical, a subjective judgment call, or a bot-walled action. Today there's no standard way for an agent to autonomously *discover, hire, verify, and pay* a human for a one-off task without a human operator in the loop on the requesting side.

## Solution

Levantate Bridge is a marketplace where:

1. An agent posts a task with a max budget (e.g. "collect and summarize complaints from residents in this neighborhood").
2. Verified human workers bid on the task within a time-limited auction window.
3. To bid, a worker must pass **World's Selfie Check** — proving they're a unique real human, preventing sybil/bot bidding and duplicate-identity abuse.
4. The agent picks a winning bid, informed by live historical data from **The Graph**.
5. Funds are escrowed in USDC on **Arc** via **Circle Wallets / Agent Stack** the moment the task is posted.
6. The worker completes the task and submits proof before a **submission deadline** set at the moment they were assigned.
7. On approval, escrowed USDC releases automatically to the worker's Circle wallet.
8. If the assigned worker misses the submission deadline, the agent **reclaims** the task: it returns to Open for a fresh round of bidding rather than leaving escrowed USDC stranded against a worker who never delivered. The miss is recorded on-chain and counts against that worker's reputation in future selections.
9. All marketplace activity (tasks, bids, payments, missed deadlines) is indexed via **The Graph** (Subgraph Studio), and the agent queries this live data to make its budgeting and worker-selection decisions based on real historical signals (e.g. typical price for similar tasks, a worker's completion track record) rather than a naive rule.

Single settlement rail throughout: USDC on Arc via Circle. No cross-chain bridging or swapping anywhere in the flow.

### Two deadlines, not one

The marketplace tracks two independent deadlines per task, and they must not be conflated:

- **`bidDeadline`** — closes the auction window. Set at `postTask`. Bids revert after it; winner selection reverts before it.
- **`submissionDeadline`** — bounds how long the assigned worker has to deliver. Set at `selectWinner` as `block.timestamp + submissionWindow`, where `submissionWindow` is a duration committed at `postTask`. Work submission reverts after it.

Without the second deadline, a worker who wins a bid and then disappears leaves the task permanently `Assigned` with the agent's USDC escrowed against work that will never arrive. `reclaimTask` closes that hole: after `submissionDeadline` passes with no submission, the agent returns the task to Open for a new bidding round. The escrow stays locked across the reclaim (the task still needs doing at the same budget); it is only refunded if a round then closes with no bids at all.

A missed deadline is a first-class reputation signal, not just a state reset — it is emitted on-chain and indexed, so the agent's future bid scoring can weigh "this worker won a task and never delivered" alongside price and completion rate.

### Transaction confirmation is subgraph-driven

Because the backend relays transactions on behalf of workers, **a returned transaction hash is not proof that anything happened on-chain.** A hash means "submitted," and a submitted transaction can still revert, get dropped, or be superseded.

The single source of truth for "this happened on-chain" is the **subgraph's indexed events**. Every relayed transaction is tracked as `pending` from submission and only becomes `confirmed` when its corresponding event appears in the subgraph. Nothing in the API, the frontend, or the demo may report success on receipt of a hash alone.

This has two structural consequences:

- **Every state-transition function must emit an event.** If a transition is silent on-chain, the backend has no way to confirm it. This is why the event set is larger than the four originally listed.
- **The relayer needs strict nonce sequencing.** One relayer wallet submits on behalf of many workers concurrently, and EVM nonces must be used in order with no gaps. Concurrent submissions from a single wallet race on nonce assignment, where the first transaction wins and the rest fail. Relayer submissions are therefore serialized through a single-concurrency queue, and every submission carries an idempotency key so retries cannot double-submit.

## Where each sponsor product is used

This is the explicit mapping to call out in the README, diagram labels, and demo narration — each sponsor's product needs to be visibly doing real work, not just name-dropped.

- **Circle (Agent Stack / Circle Wallets / Arc)**
  - The requesting agent holds a **Circle Developer-Controlled Wallet**, used to fund the escrow in USDC.
  - Each verified worker gets a **Circle Wallet** auto-created (keyed to their World ID nullifier) to receive payment — no wallet setup burden on the worker.
  - The **escrow contract is deployed on Arc**, using USDC as the native gas/settlement asset.
  - Payment release (`approveWork` → `releasePayment`) is an autonomous on-chain USDC settlement triggered by the agent — this is the core "agent transacts on Arc" demonstration.
- **World ID (Selfie Check)**
  - A worker must pass **Selfie Check** (via IDKit/MiniKit, World ID sandbox) before their bid is accepted.
  - The proof is verified server-side; the **nullifier hash** is stored and checked to block one person from bidding under multiple identities.
  - This is the abuse-prevention/fairness use case: Selfie Check is gating *economic participation eligibility* in an auction, not identity verification.
- **The Graph (Subgraph Studio)**
  - A subgraph indexes every state transition the escrow contract emits: `TaskPosted`, `BidPlaced`, `WorkerAssigned`, `WorkSubmitted`, `WorkRejected`, `PaymentReleased`, `TaskReclaimed`, `TaskCancelled`.
  - The **agent queries this subgraph live** before setting its budget or picking a winning bid — e.g. "what did similar tasks pay historically," "what's this worker's completion rate," "has this worker ever missed a submission deadline."
  - The subgraph is also the **confirmation layer**: it is the authority on whether a relayed transaction actually landed, so the backend's pending/confirmed state machine reads from it rather than trusting transaction hashes.
  - This is the "AI use case with The Graph" requirement: real reasoning over live on-chain data, not a raw query printout.



## Architecture overview

```
[Requesting Agent]
   |--(1) postTask(description, maxBudget, bidDeadline, submissionWindow)--> [Escrow Contract on Arc]
   |                                                 (locks USDC from agent's Circle Wallet)
   |
[Worker] --(2) Selfie Check verify (World ID sandbox)--> [Backend: verify proof, store nullifier]
   |
   |--(3) placeBid()--> [Backend / Marketplace API] --> [Escrow Contract] (records bid)
   |                    (relayed: serialized nonce queue, tracked pending)
   |
[Agent] --(4) queries Subgraph for historical price / completion rate / missed deadlines--> [The Graph]
   |
   |--(5) selectWinner()--> [Escrow Contract] (assigns task, sets submissionDeadline)
   |
[Worker] --(6) submitWork(proofHash)--> [Backend] --> [Escrow Contract]  (reverts past submissionDeadline)
   |
[Agent] --(7) approveWork()--> [Escrow Contract] --(8) releasePayment()--> [Worker's Circle Wallet on Arc]
   |
   |--(7b) reclaimTask() if submissionDeadline passed with no submission--> [Escrow Contract]
   |        (task returns to Open for re-bidding; miss recorded as a reputation signal)
   |
[Subgraph] indexes every state transition throughout, and is the source of truth
           that confirms whether each relayed transaction actually landed
   |
[Backend] polls Subgraph to move relayed txs from pending -> confirmed
```



## Components to build

1. **Escrow smart contract** (Solidity, Arc testnet) — states: Open → Bidding → Assigned → Submitted → Paid, plus Cancelled as a terminal state. Functions: `postTask`, `placeBid`, `selectWinner`, `submitWork`, `approveWork` (triggers USDC release), `rejectWork`, `reclaimTask` (Assigned → Open after a missed `submissionDeadline`), `cancelTask` (refund when a bidding round closes with no bids). Every one of these emits an event, since the subgraph is the confirmation authority.
2. **Circle integration** — Developer-Controlled Wallets via Agent Stack: one wallet for the requesting agent, auto-created wallets per verified worker (keyed to their World ID nullifier).
3. **World ID Selfie Check integration** — IDKit/MiniKit in sandbox mode; server-side proof verification; nullifier hash stored to block duplicate-identity bidding.
4. **Backend / marketplace API** — orchestrates the full state machine, talks to the contract (viem/ethers) and Circle SDK. Includes the **relayed-transaction tracker**: a serialized, idempotent submission queue per wallet plus a pending→confirmed reconciler driven by subgraph events.
5. **Subgraph** (Subgraph Studio) — indexes every contract event listed in the sponsor mapping above. Schema entities: `Task`, `Bid`, `Worker`, `Payment`, `MissedDeadline`. `Worker` carries the derived reputation fields the agent scores on, including missed-deadline counts.
6. **Agent logic** — sets max budget and evaluates bids using live subgraph queries (historical price for similar tasks, a worker's completion rate, a worker's missed-deadline history) rather than a hardcoded rule.
7. **Worker-facing frontend** — browse open tasks, complete Selfie Check, bid, submit proof of completed work.
8. **Architecture diagram + README** — explicitly label which sponsor product powers which part of the flow (see mapping above).
9. **Demo video** + **Selfie Check feedback document** (sandbox notes, what was confusing/broken).



## Tech stack (proposed)

- Contracts: Solidity, deployed to Arc testnet
- Backend: Node.js/TypeScript, viem or ethers for chain calls, Circle Wallets SDK
- Identity: World ID IDKit/MiniKit (sandbox), Selfie Check credential
- Indexing: The Graph — Subgraph Studio, AssemblyScript mappings
- Frontend: Next.js/React, minimal styling, functional over polished
- All testnets: Arc testnet, World ID sandbox, Subgraph Studio against testnet contract



## Repo structure

Keep a clean top-level split — do not mix concerns into shared folders:

```
/contracts     — Solidity escrow contract, deployment scripts, Arc testnet config
/backend       — marketplace API, Circle SDK integration, World ID verification, chain calls
/frontend      — worker-facing web app
/subgraph      — schema.graphql, mappings, subgraph manifest for Subgraph Studio
/docs          — architecture diagram, README content, Selfie Check feedback doc
```

Each folder should be independently runnable/buildable (its own package.json where applicable) rather than one monolithic app mixing contract code, API routes, and frontend components together.

## Build plan

1. Set up Circle developer account and Agent Stack wallets; write and deploy the escrow contract skeleton to Arc testnet; manually test `postTask`/`placeBid`/`releasePayment`.
2. Integrate World ID Selfie Check sandbox into the bidding flow; verify proofs server-side; store nullifiers and block duplicate-identity bids.
3. Build the full backend marketplace API (complete state machine) wired to the contract and Circle SDK, including the serialized relayer queue.
4. Write and deploy the subgraph against the testnet contract; confirm every event type is indexed correctly, including missed-deadline reclaims.
5. Wire the backend's pending→confirmed transaction reconciler to the subgraph, so no relayed transaction is reported successful on hash alone.
6. Build the agent logic that queries the subgraph to set budgets and select winning bids based on real historical data, penalizing workers with missed deadlines.
7. Build the worker-facing frontend: browse tasks, Selfie Check, bid, submit proof, with pending-vs-confirmed transaction states surfaced.
8. Run the full flow end-to-end, including the missed-deadline reclaim path; fix breakage.
9. Produce the architecture diagram (with sponsor-product labels), README, demo video, and Selfie Check feedback document.



## Implementation notes for the coding agent

- Use web search whenever uncertain about current Circle Agent Stack SDK method names, World ID IDKit/MiniKit API signatures, Arc testnet RPC/chain ID details, or Subgraph Studio deployment steps — do not guess or hallucinate API surface; verify against current docs before writing code that depends on it.
- Keep the implementation minimal and functional. Do not add unused abstractions, placeholder functions, speculative config options, or scaffolding for features not in this spec.
- If a piece of code stops being used after a refactor (a function, a route, a contract method, an unused import), delete it — do not leave dead code in the repo.
- Favor one working end-to-end path over broad partial coverage. If time runs short, a fully working demo of Circle + Selfie Check + Graph subgraph in one clean flow beats several half-finished features.
- Every external integration (Circle, World ID, The Graph) must hit real testnet/sandbox endpoints — no mocked or hardcoded fake responses standing in for actual calls.
- Never treat a returned transaction hash as proof of success, and never fire relayed transactions in parallel from a single wallet. See "Transaction confirmation is subgraph-driven" above; the operational rules are in `AGENTS.md`.
- Every sponsor integration must be visibly demonstrable and labeled as such in the README/diagram/demo video — see the "Where each sponsor product is used" section above.
- Before writing any code, verify the current/latest stable versions of every major dependency (Solidity compiler version, Circle SDK package version, World ID IDKit/MiniKit version, The Graph CLI/graph-node tooling, Next.js/React versions, viem/ethers versions) via web search — do not default to versions from training data, which may be outdated. Pin these verified versions in each package's config (package.json, foundry/hardhat config, etc.).



## Git commit cadence

Commit after each meaningfully complete feature — not one giant commit at the end, and not commits mid-broken-state. Suggested commit points:

- Escrow contract written and deployed to Arc testnet (including deadline and reclaim logic)
- Circle wallet creation (agent + worker) working
- World ID Selfie Check verification working end-to-end
- Relayer submission queue working (serialized nonces, idempotent retries)
- Backend payment/escrow release logic working
- Subgraph deployed and returning indexed data
- Transaction confirmation tracker working (pending → confirmed driven by subgraph events)
- Agent decision logic (subgraph-informed bid selection) working
- Frontend task browse/bid/submit flow working
- Missed-deadline reclaim path verified end-to-end
- Full end-to-end flow verified working
- Diagram, README, and docs added

Each commit message should name the feature and confirm it was tested (e.g. "Add escrow release logic — tested payout to worker wallet on Arc testnet"), not just describe files changed.