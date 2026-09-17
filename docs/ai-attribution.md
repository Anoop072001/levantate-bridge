# AI tools — attribution & integrity

This document satisfies the hackathon requirement to disclose **where AI was used** in Levantate Bridge. It covers two separate things:

1. **Product AI** — models that run *in the demo* (operator MCP clients).
2. **Development AI** — assistants used while *building* the repo (e.g. Cursor).

Planning artifacts that directed implementation (not generated blindly): [`docs/spec.md`](spec.md), [`PLAN.md`](../PLAN.md), [`AGENTS.md`](../AGENTS.md).

---

## 1. AI in the product (runtime)

These are intentional features judges can exercise in the demo.

| Tool | Model / SDK | Where | Purpose |
| ---- | ----------- | ----- | ------- |
| **MCP** | External clients (Claude, ChatGPT, Cursor) | `backend/src/mcp/http.ts`, `backend/scripts/run-mcp.ts`, `backend/src/mcp/register.ts` | Streamable HTTP `/mcp` (OAuth or agent API key) or local stdio; tools spend **that** agent's Circle wallet. Operators do not use a website console. After a worker submits, **that same model** reads `get_task.submitted_proof` and calls `approve_work` or `reject_work`. |

**Not LLM-driven (platform has no OpenAI/Anthropic client):** bid winner scoring (`backend/src/agent/score-bids.ts` — The Graph statistics), World ID verification, Circle/Arc settlement, subgraph indexing, file-text extraction for the operator model (`backend/src/proof/extract.ts`).

---

## 2. AI in development (build process)

| Tool | How it was used | Human role |
| ---- | ----------------- | ---------- |
| **Cursor** (AI-assisted IDE) | Implementation help across backend, frontend, subgraph, and docs; debugging; refactors; integration wiring | Team defined requirements in `spec.md` / `PLAN.md`, chose sponsor integrations (Circle, World ID, Graph), configured real testnet credentials, ran E2E flows on Arc, deployed subgraph and contracts |
| **Cursor Agent** | Generated or edited many TypeScript/Solidity files **under** those specs | Reviewed diffs, tested against live Circle / World ID / Graph / Supabase endpoints per `AGENTS.md` (no mocked integrations) |

**Principle:** AI accelerated coding and documentation; **architecture, sponsor mapping, security boundaries (self-custodied workers, RPC receipt confirmation, per-bid Selfie Check), and testnet verification** were human-directed via the spec and plan files above.

We did **not** use a separate spec-kit / OpenSpec / Kiro repo — planning lives in `docs/spec.md`, `PLAN.md`, and `AGENTS.md` in this repository.

---

## 3. What was not AI-generated end-to-end

- Escrow contract design and Foundry tests (`contracts/`) — written and tested against Arc testnet behavior.
- Circle wallet setup, relayer nonce queue, Arc RPC receipt confirmation — implemented to match Circle/Arc docs and real API behavior.
- World ID Selfie Check flow — IDKit + server verify + `spent_proofs`; required sandbox device testing.
- Subgraph schema and mappings — tied to deployed contract address and eight events on `arc-testnet`.
- Secrets, Supabase schema, Heroku deployment config — human-operated.

---

## 4. Files most touched by AI-assisted development (non-exhaustive)

| Area | Representative paths |
| ---- | -------------------- |
| Backend API & relayer | `backend/src/server.ts`, `routes/`, `relayer/`, `agent/` |
| Frontend worker UI | `frontend/app/`, `frontend/components/` |
| Integrations | `backend/src/circle/`, `world-id/`, `subgraph/client.ts`, `frontend/components/SelfieCheck.tsx` |
| Docs | `README.md`, `docs/architecture.md`, `docs/circle-arc.md`, `docs/world-selfie-check.md`, `docs/graph.md` |

All changes were iteratively reviewed and run against real testnet/sandbox services.

---

## 5. Short statement for submission forms

> **Product:** Operators post, review proofs, and settle through MCP (Claude, ChatGPT, Cursor). Levantate does not call OpenAI or Anthropic. **Development:** Cursor AI assisted implementation and docs under human-written specs (`docs/spec.md`, `PLAN.md`, `AGENTS.md`). Integrations hit real Circle, World ID, Graph, and Arc testnet endpoints. AI assisted development; it did not replace human design, testing, or deployment decisions.
