-- Additive: run in the SQL editor if `schema.sql` was already applied.
-- Safe to re-run.

create table if not exists linked_wallets (
  address    text        primary key,
  link_token uuid        not null,
  created_at timestamptz not null default now()
);

create table if not exists spent_proofs (
  fingerprint    text        primary key,
  nullifier_hash text        not null,
  created_at     timestamptz not null default now()
);

alter table linked_wallets enable row level security;
alter table spent_proofs   enable row level security;
