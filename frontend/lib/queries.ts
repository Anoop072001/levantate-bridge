"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchBids, fetchTask, fetchTaskProof, fetchTasks, fetchWorkerBalance } from "./api";
import { isAgentSelectingTask } from "./task-status";
import type { Task } from "./types";

export const queryKeys = {
  tasks: ["tasks"] as const,
  task: (id: number) => ["tasks", id] as const,
  bids: (taskId: number, round?: number) =>
    round === undefined ? (["tasks", taskId, "bids"] as const) : (["tasks", taskId, "bids", round] as const),
  workerBalance: (address: string) => ["workers", address, "balance"] as const,
  proof: (taskId: number, round?: number) =>
    round === undefined
      ? (["tasks", taskId, "proof"] as const)
      : (["tasks", taskId, "proof", round] as const),
};

const LIST_STALE_MS = 10_000;
const SELECTING_POLL_MS = 5_000;

function tasksNeedPolling(tasks: Task[] | undefined): boolean {
  return tasks?.some(isAgentSelectingTask) ?? false;
}

export function useTasksQuery() {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: fetchTasks,
    staleTime: LIST_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (tasksNeedPolling(query.state.data as Task[] | undefined) ? SELECTING_POLL_MS : false),
  });
}

export function useTaskQuery(taskId: number) {
  return useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: Number.isFinite(taskId) && taskId >= 0,
    staleTime: LIST_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const task = query.state.data as Task | undefined;
      return task && isAgentSelectingTask(task) ? SELECTING_POLL_MS : false;
    },
  });
}

export function useBidsQuery(taskId: number, round?: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.bids(taskId, round),
    queryFn: () => fetchBids(taskId, round),
    enabled: enabled && Number.isFinite(taskId) && taskId >= 0,
    staleTime: LIST_STALE_MS,
  });
}

export function useTaskProofQuery(taskId: number, round?: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.proof(taskId, round),
    queryFn: () => fetchTaskProof(taskId, round),
    enabled: enabled && Number.isFinite(taskId) && taskId >= 0,
    staleTime: LIST_STALE_MS,
  });
}

export function useWorkerBalanceQuery(address: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workerBalance(address ?? ""),
    queryFn: () => fetchWorkerBalance(address!),
    enabled: Boolean(address),
    staleTime: LIST_STALE_MS,
  });
}

export function useInvalidateTaskData() {
  const queryClient = useQueryClient();
  return (taskId?: number) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    if (taskId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    void queryClient.invalidateQueries({ queryKey: ["tasks", taskId, "bids"] });
  };
}
