import type { BidRecord } from "../store.js";
import { isSubgraphAvailable } from "../subgraph/client.js";
import { fetchHistoricalPayments, fetchWorkerStatsBatch } from "./queries.js";

export interface BidScore {
  bidId: number;
  workerAddress: string;
  amount: string;
  priceScore: number;
  completionScore: number;
  historyPriceScore: number;
  missedDeadlinePenalty: number;
  totalScore: number;
  workerStats: {
    tasksAssigned: number;
    tasksPaid: number;
    missedDeadlines: number;
    completionRate: number;
  };
}

export interface BidSelectionResult {
  winner: BidScore | null;
  scores: BidScore[];
  reasoning: {
    maxBudget: string;
    medianHistoricalPaid: string | null;
    eligibleBidCount: number;
    message: string;
  };
}

export async function scoreBids(
  bids: BidRecord[],
  maxBudget: bigint,
): Promise<BidSelectionResult> {
  const eligible = bids.filter((b) => BigInt(b.amount) <= maxBudget);
  if (eligible.length === 0) {
    return {
      winner: null,
      scores: [],
      reasoning: {
        maxBudget: maxBudget.toString(),
        medianHistoricalPaid: null,
        eligibleBidCount: 0,
        message: "No eligible bids at or below maxBudget",
      },
    };
  }

  const subgraphUp = isSubgraphAvailable();
  const payments = subgraphUp ? await fetchHistoricalPayments() : [];
  const amounts = payments.map((p) => BigInt(p.workerAmount)).sort((a, b) => Number(a - b));
  const medianHistorical =
    amounts.length > 0 ? amounts[Math.floor(amounts.length / 2)] : null;

  const workerStats = subgraphUp
    ? await fetchWorkerStatsBatch(eligible.map((b) => b.workerAddress))
    : new Map<string, null>();
  const scores: BidScore[] = [];

  for (const bid of eligible) {
    const amount = BigInt(bid.amount);
    const stats = workerStats.get(bid.workerAddress.toLowerCase()) ?? null;
    const tasksAssigned = stats?.tasksAssigned ?? 0;
    const tasksPaid = stats?.tasksPaid ?? 0;
    const missedDeadlines = stats?.missedDeadlines ?? 0;
    const completionRate = stats ? parseFloat(stats.completionRate) : 0;

    const priceScore = maxBudget > 0n ? Number(maxBudget - amount) / Number(maxBudget) : 0;
    const completionScore = completionRate;
    const historyPriceScore =
      medianHistorical && medianHistorical > 0n
        ? 1 - Math.min(1, Math.abs(Number(amount - medianHistorical)) / Number(medianHistorical))
        : 0.5;
    const missedDeadlinePenalty = missedDeadlines * 0.25;

    const totalScore =
      0.35 * priceScore + 0.35 * completionScore + 0.2 * historyPriceScore - missedDeadlinePenalty;

    scores.push({
      bidId: bid.id,
      workerAddress: bid.workerAddress,
      amount: amount.toString(),
      priceScore,
      completionScore,
      historyPriceScore,
      missedDeadlinePenalty,
      totalScore,
      workerStats: { tasksAssigned, tasksPaid, missedDeadlines, completionRate },
    });
  }

  scores.sort((a, b) => b.totalScore - a.totalScore);
  const winner = scores[0] ?? null;

  let message: string;
  if (eligible.length === 0) {
    message = "No eligible bids at or below maxBudget";
  } else if (winner) {
    message = `Selected bid ${winner.bidId} from ${winner.workerAddress} (score ${winner.totalScore.toFixed(3)}): ` +
      `price=${winner.priceScore.toFixed(2)}, completion=${winner.completionScore.toFixed(2)}, ` +
      `historyFit=${winner.historyPriceScore.toFixed(2)}, missedPenalty=${winner.missedDeadlinePenalty.toFixed(2)}`;
  } else {
    message = "No winner";
  }

  return {
    winner,
    scores,
    reasoning: {
      maxBudget: maxBudget.toString(),
      medianHistoricalPaid: medianHistorical?.toString() ?? null,
      eligibleBidCount: eligible.length,
      message,
    },
  };
}
