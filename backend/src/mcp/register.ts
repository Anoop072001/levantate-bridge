import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
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

/** Registers all Levantate Bridge marketplace tools for MCP clients (Claude Desktop, Cursor, etc.). */
export function registerLevantateMcpTools(server: McpServer): void {
  server.registerTool(
    "list_tasks",
    { description: "List every task with on-chain state, budget, deadlines, and bid count." },
    async () => toolResult(await runAgentTool("list_tasks", {})),
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
    async ({ task_id }) => toolResult(await runAgentTool("get_task", { task_id })),
  );

  server.registerTool(
    "score_bids",
    {
      description: "Score bids using subgraph history without assigning a winner.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => toolResult(await runAgentTool("score_bids", { task_id })),
  );

  server.registerTool(
    "post_task",
    {
      description: "Escrow USDC and post a new task on Arc testnet.",
      inputSchema: z.object({
        description: z.string(),
        bid_deadline_minutes: z.number(),
        submission_window_minutes: z.number().optional(),
        max_budget_usdc: z.number().optional(),
      }),
    },
    async (args) => toolResult(await runAgentTool("post_task", args)),
  );

  server.registerTool(
    "select_winner",
    {
      description: "Assign a task to a bidder after the bid deadline.",
      inputSchema: z.object({
        task_id: z.number().int(),
        bid_id: z.number().int().optional(),
      }),
    },
    async (args) => toolResult(await runAgentTool("select_winner", args)),
  );

  server.registerTool(
    "evaluate_proof",
    {
      description:
        "LLM proof evaluation for submitted work — returns APPROVE/REJECT with reason, does not settle on-chain.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => toolResult(await runAgentTool("evaluate_proof", { task_id })),
  );

  server.registerTool(
    "approve_work",
    {
      description: "Approve submitted work and release USDC to the worker wallet.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => toolResult(await runAgentTool("approve_work", { task_id })),
  );

  server.registerTool(
    "reject_work",
    {
      description: "Reject submitted work so the worker can resubmit.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => toolResult(await runAgentTool("reject_work", { task_id })),
  );

  server.registerTool(
    "reclaim_task",
    {
      description: "Reopen bidding after a missed submission deadline.",
      inputSchema: z.object({
        task_id: z.number().int(),
        new_bid_deadline_minutes: z.number(),
      }),
    },
    async (args) => toolResult(await runAgentTool("reclaim_task", args)),
  );

  server.registerTool(
    "cancel_task",
    {
      description: "Cancel an open task and refund escrow to the agent wallet.",
      inputSchema: z.object({ task_id: z.number().int() }),
    },
    async ({ task_id }) => toolResult(await runAgentTool("cancel_task", { task_id })),
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
    async (args) => toolResult(await runAgentTool("get_proof_download", args)),
  );

  server.registerTool(
    "get_transaction",
    {
      description: "Look up a relayed transaction by id (hash and status).",
      inputSchema: z.object({ transaction_id: z.string() }),
    },
    async ({ transaction_id }) =>
      toolResult(await runAgentTool("get_transaction", { transaction_id })),
  );
}
