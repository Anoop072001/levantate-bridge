import type { IncomingMessage, ServerResponse } from "node:http";
import { registerAgent } from "../agents/register.js";
import { actorFromAgent, requireAgentAuth } from "../auth/agent.js";
import { AGENT_TRANSFER_GAS_RESERVE_MICRO, transferAgentUsdc } from "../agent/operations.js";
import {
  checkAgentFunding,
  fundingHintPayload,
  readAgentUsdcBalance,
} from "../chain/agent-wallet.js";
import { pendingHandle } from "../relayer/submit.js";

export async function handleAgentsRoute(
  req: IncomingMessage,
  _res: ServerResponse,
  url: URL,
  body: unknown,
  json: (status: number, payload: unknown) => void,
): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/agents/register") {
    const input = body as { name?: string };
    try {
      const result = await registerAgent(input.name);
      json(201, {
        apiKey: result.apiKey,
        agentId: result.agent.id,
        name: result.agent.name,
        walletAddress: result.agent.address,
        faucetUrl: result.faucetUrl,
        note: "Store the apiKey now — it is not shown again. Fund the wallet on Arc Testnet before posting tasks.",
      });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Agent registration failed" });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/agents/me") {
    const agent = await requireAgentAuth(req, json);
    if (!agent) return true;
    try {
      const requiredParam = url.searchParams.get("requiredUsdc");
      const requiredMicro =
        requiredParam && Number(requiredParam) > 0
          ? BigInt(Math.round(Number(requiredParam) * 1_000_000))
          : 0n;
      const { address, balanceMicro } = await readAgentUsdcBalance(agent.address as `0x${string}`);
      const check =
        requiredMicro > 0n
          ? await checkAgentFunding(requiredMicro, address)
          : {
              agentAddress: address,
              balanceMicro,
              requiredMicro: 0n,
              sufficient: balanceMicro > 0n,
              faucetUrl: "https://faucet.circle.com",
            };
      json(200, {
        agentId: agent.id,
        name: agent.name,
        ...fundingHintPayload(check),
        sufficient: check.sufficient,
        balanceMicro: balanceMicro.toString(),
      });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "Agent wallet lookup failed" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agents/transfer") {
    const agent = await requireAgentAuth(req, json);
    if (!agent) return true;
    const input = body as { to?: string; amountUsdc?: number; sendAll?: boolean };
    const to = input.to?.trim() ?? "";
    try {
      let amountMicro: bigint;
      if (input.sendAll) {
        const { balanceMicro } = await readAgentUsdcBalance(agent.address as `0x${string}`);
        amountMicro = balanceMicro - AGENT_TRANSFER_GAS_RESERVE_MICRO;
        if (amountMicro <= 0n) {
          json(402, { error: "Insufficient USDC to transfer after the 0.02 USDC gas reserve" });
          return true;
        }
      } else if (input.amountUsdc === undefined || !Number.isFinite(input.amountUsdc) || input.amountUsdc <= 0) {
        json(400, { error: "amountUsdc must be a positive number, or set sendAll" });
        return true;
      } else {
        amountMicro = BigInt(Math.round(input.amountUsdc * 1_000_000));
      }
      const result = await transferAgentUsdc(to, amountMicro, actorFromAgent(agent));
      if (!result.ok) {
        json(result.status, {
          error: result.error,
          ...(result.funding ? { funding: result.funding } : {}),
          ...(result.transaction ? pendingHandle(result.transaction) : {}),
        });
        return true;
      }
      json(202, {
        to: result.to,
        amountMicro: result.amountMicro.toString(),
        ...pendingHandle(result.transaction),
      });
    } catch (err) {
      json(500, { error: err instanceof Error ? err.message : "USDC transfer failed" });
    }
    return true;
  }

  return false;
}
