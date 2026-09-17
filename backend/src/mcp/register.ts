import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AgentActor } from "../agent/operations.js";
import { runAgentTool } from "../agent/tools.js";

function toolResult(outcome: Awaited<ReturnType<typeof runAgentTool>>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { ok: outcome.ok, summary: outcome.summary, payload: outcome.payload },
          null,
          2,
        ),
      },
    ],
    isError: !outcome.ok,
  };
}

const UNAUTHENTICATED: Awaited<ReturnType<typeof runAgentTool>> = {
  ok: false,
  summary: "Agent authentication required",
  payload: {
    error:
      "Add the connector request header authorization with value Bearer <apiKey> from POST /api/agents/register.",
  },
  transactions: [],
};

async function callTool(
  actor: AgentActor | undefined,
  name: string,
  args: Record<string, unknown> = {},
) {
  if (!actor) return toolResult(UNAUTHENTICATED);
  return toolResult(await runAgentTool(name, args, actor));
}

/** Registers marketplace tools. Writes no-op with an auth error when no valid agent key is on the request. */
export function registerLevantateMcpTools(server: McpServer, actor?: AgentActor): void {
  server.registerTool(
    "list_tasks",
    { description: "List every task with on-chain state, budget, deadlines, and bid count." },
    async () => callTool(actor, "list_tasks"),
  );

  server.registerTool(
    "get_task",
    {
      description:
        "Full task detail including bids and submitted proof content (text extracted from Excel/PDF/Word when paid or submitted).",
      inputSchema: z.object({
        task_id: z.number().int().describe("Task id"),
      }),
    },
    async ({ task_id }) => callTool(actor, "get_task", { task_id }),
  );

  server.registerTool(
    "score_bids",
    {
      description: "Score bids using subgraph history without assigning a winner.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => callTool(actor, "score_bids", { task_id }),
  );

  server.registerTool(
    "get_agent_wallet",
    {
      description:
        "Show this agent's Circle wallet address and USDC balance on Arc. Call before post_task if funding might be low.",
      inputSchema: z.object({
        required_usdc: z.number().optional().describe("Optional task budget to compare against (plain USDC)."),
      }),
    },
    async (args) => callTool(actor, "get_agent_wallet", args),
  );

  server.registerTool(
    "transfer_usdc",
    {
      description:
        "Send unused USDC from this agent's Circle wallet to an external address. Does not move worker earnings. Confirm recipient and amount first.",
      inputSchema: z.object({
        to: z.string().describe("Recipient 0x address"),
        amount_usdc: z.number().optional().describe("Amount in plain USDC. Omit when send_all is true."),
        send_all: z.boolean().optional().describe("Send balance minus a 0.02 USDC gas reserve."),
      }),
    },
    async (args) => callTool(actor, "transfer_usdc", args),
  );

  server.registerTool(
    "post_task",
    {
      description: "Escrow USDC from this agent's wallet and post a new task on Arc testnet.",
      inputSchema: z.object({
        description: z.string(),
        bid_deadline_minutes: z.number(),
        submission_window_minutes: z.number().optional(),
        max_budget_usdc: z.number().optional(),
      }),
    },
    async (args) => callTool(actor, "post_task", args),
  );

  server.registerTool(
    "select_winner",
    {
      description: "Assign a task to a bidder after the bid deadline. Only works for tasks this agent posted.",
      inputSchema: z.object({
        task_id: z.number().int(),
        bid_id: z.number().int().optional(),
      }),
    },
    async (args) => callTool(actor, "select_winner", args),
  );

  server.registerTool(
    "evaluate_proof",
    {
      description:
        "LLM proof evaluation for submitted work — returns APPROVE/REJECT with reason, does not settle on-chain.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => callTool(actor, "evaluate_proof", { task_id }),
  );

  server.registerTool(
    "approve_work",
    {
      description: "Approve submitted work and release USDC to the worker wallet. Poster only.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => callTool(actor, "approve_work", { task_id }),
  );

  server.registerTool(
    "reject_work",
    {
      description: "Reject submitted work so the worker can resubmit. Poster only.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => callTool(actor, "reject_work", { task_id }),
  );

  server.registerTool(
    "reclaim_task",
    {
      description: "Reopen bidding after a missed submission deadline. Poster only.",
      inputSchema: z.object({
        task_id: z.number().int(),
        new_bid_deadline_minutes: z.number(),
      }),
    },
    async (args) => callTool(actor, "reclaim_task", args),
  );

  server.registerTool(
    "cancel_task",
    {
      description: "Cancel an open task and refund escrow to this agent's wallet. Poster only.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => callTool(actor, "cancel_task", { task_id }),
  );

  server.registerTool(
    "get_proof_download",
    {
      description: "Download link for a worker's uploaded proof file on a Submitted or Paid task.",
      inputSchema: z.object({
        task_id: z.number().int(),
        round: z.number().int().optional(),
      }),
    },
    async (args) => callTool(actor, "get_proof_download", args),
  );

  server.registerTool(
    "get_transaction",
    {
      description: "Look up a relayed transaction by id. Status is confirmed/failed after Arc RPC receipt.",
      inputSchema: z.object({ transaction_id: z.string() }),
    },
    async ({ transaction_id }) => callTool(actor, "get_transaction", { transaction_id }),
  );
}
