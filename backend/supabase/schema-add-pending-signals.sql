-- Run once on an existing Supabase project that already has the base schema.
create table if not exists pending_signals (
  token      uuid        primary key,
  signal     text        not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists pending_signals_expires_idx on pending_signals (expires_at);

alter table pending_signals enable row level security;
