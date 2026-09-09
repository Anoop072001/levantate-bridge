"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, Coins, MapPin, Search, Users } from "lucide-react";
import { Countdown } from "@/components/Countdown";
import { cn } from "@/lib/cn";
import { taskBudgetLabel, taskHeadline } from "@/lib/task-display";
import { isBiddingOpen, taskDisplayStatus } from "@/lib/task-status";
import { secondsRemaining } from "@/lib/time";
import type { Task } from "@/lib/types";

export function TaskBoard({
  tasks,
  loading,
  error,
  sessionHint,
  onBid,
}: {
  tasks: Task[];
  loading?: boolean;
  error?: string | null;
  sessionHint?: React.ReactNode;
  onBid: (task: Task) => void;
}) {
  const [stateFilter, setStateFilter] = useState("");
  const [roundFilter, setRoundFilter] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [search, setSearch] = useState("");

  const states = useMemo(
    () => [...new Set(tasks.map((t) => taskDisplayStatus(t)))].sort(),
    [tasks],
  );
  const rounds = useMemo(() => [...new Set(tasks.map((t) => `Round ${t.round}`))], [tasks]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (stateFilter) list = list.filter((t) => taskDisplayStatus(t) === stateFilter);
    if (roundFilter) list = list.filter((t) => `Round ${t.round}` === roundFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.description.toLowerCase().includes(q) || String(t.id).includes(q));
    }
    if (sortBy === "Budget high") {
      list = [...list].sort((a, b) => Number(b.maxBudget) - Number(a.maxBudget));
    }
    if (sortBy === "Budget low") {
      list = [...list].sort((a, b) => Number(a.maxBudget) - Number(b.maxBudget));
    }
    if (sortBy === "Title A–Z") {
      list = [...list].sort((a, b) => taskHeadline(a.description).localeCompare(taskHeadline(b.description)));
    } else if (!sortBy) {
      list = [...list].sort((a, b) => {
        const rank = (t: Task) => (isBiddingOpen(t) ? 0 : 1);
        return rank(a) - rank(b) || Number(b.maxBudget) - Number(a.maxBudget);
      });
    }
    return list;
  }, [tasks, stateFilter, roundFilter, search, sortBy]);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-12 space-y-5 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground">
          <Users className="h-3 w-3" />
          Open on Arc testnet
        </span>
        <h1 className="text-4xl leading-[1.1] font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
          Tasks that pay in USDC
        </h1>
        <p className="mx-auto max-w-md text-base leading-relaxed text-muted-foreground">
          Bid under the budget, pass a Selfie Check, and settle to a wallet you control.
        </p>
        {sessionHint}
      </div>

      <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col divide-y divide-border overflow-hidden rounded-lg border border-border sm:w-auto sm:flex-row sm:divide-x sm:divide-y-0">
          <FilterDropdown label="All states" options={states} value={stateFilter} onChange={setStateFilter} />
          <FilterDropdown label="All rounds" options={rounds} value={roundFilter} onChange={setRoundFilter} />
          <FilterDropdown
            label="Sort by"
            options={["Budget high", "Budget low", "Title A–Z"]}
            value={sortBy}
            onChange={setSortBy}
          />
        </div>

        <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 transition-all focus-within:ring-2 focus-within:ring-gray-300 sm:w-52">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {error && <p className="mb-4 text-center text-sm text-red-700">{error}</p>}

      <div className="min-h-[180px]">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading tasks…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {tasks.length === 0
              ? "No tasks right now."
              : "No tasks match — try adjusting your filters."}
          </p>
        ) : (
          filtered.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              isLast={i === filtered.length - 1}
              onBid={() => onBid(task)}
            />
          ))
        )}
      </div>

      <div className="mt-4 space-y-2 border-t border-border pt-8 text-center">
        <p className="text-sm text-muted-foreground">Need a payout address first?</p>
        <Link
          href="/verify?return=/tasks"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-gray-600"
        >
          Link wallet
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

function FilterDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="w-full px-3 py-0.5 sm:w-auto">
      <select
        value={value || "all"}
        onChange={(e) => onChange(e.target.value === "all" ? "" : e.target.value)}
        className="h-10 w-full border-none bg-transparent px-0 text-sm font-medium text-foreground shadow-none outline-none"
      >
        <option value="all">{label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function TaskRow({
  task,
  isLast,
  onBid,
}: {
  task: Task;
  isLast: boolean;
  onBid: () => void;
}) {
  const open = isBiddingOpen(task);
  const status = taskDisplayStatus(task);
  const closed = !open && (task.state === 0 || task.state === 1);

  return (
    <div
      className={cn(
        "group flex flex-col justify-between gap-4 py-6 sm:flex-row sm:items-center sm:gap-6",
        "transition-colors duration-150",
        !isLast && "border-b border-border",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <Link
          href={`/tasks/${task.id}`}
          className="text-base leading-snug font-semibold tracking-tight text-foreground hover:underline"
        >
          {taskHeadline(task.description)}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <MetaItem icon={<MapPin className="h-2.5 w-2.5" />} label="Arc testnet" />
          <Dot />
          <MetaItem icon={<Clock className="h-2.5 w-2.5" />} label={status} />
          <Dot />
          <MetaItem icon={<Coins className="h-2.5 w-2.5" />} label={taskBudgetLabel(task)} />
          <Dot />
          <span className="flex items-center gap-1 text-xs leading-none text-muted-foreground">
            <Clock className="h-2.5 w-2.5" />
            {closed ? "Bidding closed" : <Countdown deadlineUnix={task.bidDeadline} />}
          </span>
        </div>
      </div>

      {open ? (
        <button
          type="button"
          onClick={onBid}
          className="mt-2 flex shrink-0 items-center gap-1.5 text-sm font-medium text-foreground transition-all duration-150 hover:gap-2.5 sm:mt-0"
        >
          Bid
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>
      ) : (
        <span className="mt-2 shrink-0 text-sm text-muted-foreground sm:mt-0">Closed</span>
      )}
    </div>
  );
}

function MetaItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1 text-xs leading-none text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

function Dot() {
  return <span className="text-xs text-foreground">•</span>;
}
