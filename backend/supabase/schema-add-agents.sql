-- Per-AI requesting agents (Circle DCW + hashed API key) and task poster address.

create table if not exists agents (
  id                uuid        primary key default gen_random_uuid(),
  api_key_hash      text        not null unique,
  circle_wallet_id  text        not null unique,
  address           text        not null unique,
  name              text        not null default 'agent',
  created_at        timestamptz not null default now()
);

create index if not exists agents_api_key_hash_idx on agents (api_key_hash);
create index if not exists agents_address_idx on agents (address);

alter table agents enable row level security;

alter table tasks add column if not exists poster text;
