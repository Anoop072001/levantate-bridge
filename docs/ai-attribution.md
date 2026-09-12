# AI tools — attribution & integrity

This document satisfies the hackathon requirement to disclose **where AI was used** in Levantate Bridge. It covers two separate things:

1. **Product AI** — LLMs that run *inside* the demo (operator agent, proof review).
2. **Development AI** — assistants used while *building* the repo (e.g. Cursor).

Planning artifacts that directed implementation (not generated blindly): [`docs/spec.md`](spec.md), [`PLAN.md`](../PLAN.md), [`AGENTS.md`](../AGENTS.md).

---

## 1. AI in the product (runtime)

These are intentional features judges can exercise in the demo.

| Tool | Model / SDK | Where | Purpose |
| ---- | ----------- | ----- | ------- |
| **OpenAI** | `gpt-4o` | `backend/src/agent/chat.ts`, `frontend/components/AgentChat.tsx` | Operator chat at `/agent` — tool calling for `post_task`, `select_winner`, `approve_work`, etc. |
| **OpenAI** or **Anthropic** | `gpt-4o` or `claude-sonnet-4-20250514` | `backend/src/agent/proof-evaluator.ts`, `backend/src/agent/runner.ts` | After worker submit: LLM reads task + proof (text or extracted PDF/Word/Excel) → APPROVE/REJECT recommendation |
| **MCP (optional)** | External client (e.g. Claude Code) | `backend/scripts/run-mcp.ts`, `backend/src/mcp/register.ts` | Same escrow tools as `/agent`, for local operator use |

**Not LLM-driven:** bid winner scoring (`backend/src/agent/score-bids.ts` — The Graph statistics), World ID verification, Circle/Arc settlement, subgraph indexing.

Env: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` in `.env.local` (never committed).

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

> **Product:** OpenAI GPT-4o powers the operator agent (`/agent`) and proof evaluation; Anthropic Claude is supported as an alternate evaluator. **Development:** Cursor AI assisted implementation and docs under human-written specs (`docs/spec.md`, `PLAN.md`, `AGENTS.md`). Integrations hit real Circle, World ID, Graph, and Arc testnet endpoints. AI assisted development; it did not replace human design, testing, or deployment decisions.
