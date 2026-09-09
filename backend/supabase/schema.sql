-- Levantate Bridge — Supabase schema
-- Run once in the Supabase SQL editor of a fresh project.
-- The backend connects with the service role key, which bypasses RLS.
-- RLS is enabled with no policies so the anon/public key cannot read or write anything.

create table if not exists workers (
  nullifier_hash text primary key,
  address        text        not null unique,
  signal         text        not null,
  created_at     timestamptz not null default now()
);

create table if not exists tasks (
  id                integer     primary key,
  description       text        not null,
  max_budget        text        not null,
  bid_deadline      text        not null,
  submission_window text        not null,
  round             integer     not null,
  state             integer     not null,
  created_at        timestamptz not null default now()
);

create table if not exists bids (
  id             integer     primary key,
  task_id        integer     not null references tasks (id) on delete cascade,
  round          integer     not null,
  worker_address text        not null,
  nullifier_hash text        not null,
  amount         text        not null,
  created_at     timestamptz not null default now()
);

create index if not exists bids_task_round_idx on bids (task_id, round);

create table if not exists proofs (
  task_id      integer     not null references tasks (id) on delete cascade,
  round        integer     not null,
  content      text        not null,
  content_hash text        not null,
  created_at   timestamptz not null default now(),
  primary key (task_id, round)
);

-- No foreign key on task_id: the post_task row is written before the task row exists.
create table if not exists relayed_transactions (
  id              uuid        primary key default gen_random_uuid(),
  idempotency_key uuid        not null unique,
  kind            text        not null,
  task_id         integer,
  round           integer,
  worker          text,
  wallet_id       text        not null,
  circle_tx_id    text,
  tx_hash         text,
  status          text        not null check (status in ('queued', 'submitted', 'confirmed', 'failed')),
  expected_event  text        not null,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists relayed_transactions_status_idx on relayed_transactions (status);

-- Wallet ownership, proven by a one-off personal_sign. First bid consumes this
-- to bind the Selfie Check nullifier to the payout address.
create table if not exists linked_wallets (
  address    text        primary key,
  link_token uuid        not null,
  created_at timestamptz not null default now()
);

-- One Selfie Check proof authorizes exactly one bid (or other action).
create table if not exists spent_proofs (
  fingerprint    text        primary key,
  nullifier_hash text        not null,
  created_at     timestamptz not null default now()
);

alter table workers              enable row level security;
alter table tasks                enable row level security;
alter table bids                 enable row level security;
alter table proofs               enable row level security;
alter table relayed_transactions enable row level security;
alter table linked_wallets       enable row level security;
alter table spent_proofs         enable row level security;
