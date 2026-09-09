import {
  fetchHistoricalPayments,
  medianPaidFromPayments,
  medianSubmissionWindowFromPayments,
} from "./queries.js";

const DEFAULT_BUDGET = 1_000_000n;
const DEFAULT_SUBMISSION_WINDOW = 7200n;

export interface AgentTaskParams {
  maxBudget: bigint;
  submissionWindow: bigint;
  reasoning: {
    medianPaidAmount: string | null;
    medianSubmissionWindow: string | null;
    usedDefaults: boolean;
    subgraphUnavailable?: boolean;
  };
}

function defaultTaskParams(subgraphUnavailable = false): AgentTaskParams {
  return {
    maxBudget: DEFAULT_BUDGET,
    submissionWindow: DEFAULT_SUBMISSION_WINDOW,
    reasoning: {
      medianPaidAmount: null,
      medianSubmissionWindow: null,
      usedDefaults: true,
      subgraphUnavailable,
    },
  };
}

export async function deriveTaskParams(): Promise<AgentTaskParams> {
  try {
    const payments = await fetchHistoricalPayments();
    const medianPaid = medianPaidFromPayments(payments);
    const medianWindow = medianSubmissionWindowFromPayments(payments);
    const usedDefaults = medianPaid === null && medianWindow === null;
    return {
      maxBudget: medianPaid ?? DEFAULT_BUDGET,
      submissionWindow: medianWindow ?? DEFAULT_SUBMISSION_WINDOW,
      reasoning: {
        medianPaidAmount: medianPaid?.toString() ?? null,
        medianSubmissionWindow: medianWindow?.toString() ?? null,
        usedDefaults,
      },
    };
  } catch (err) {
    console.warn(
      `[agent] subgraph unavailable for budget derivation — using defaults: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return defaultTaskParams(true);
  }
}
