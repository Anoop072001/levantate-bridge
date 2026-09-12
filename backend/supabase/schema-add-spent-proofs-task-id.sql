-- Additive: run in the Supabase SQL editor after schema.sql / spent_proofs exists.
-- Bid Selfie Check rows get task_id; change-payout rows leave it null.

alter table spent_proofs
  add column if not exists task_id bigint references tasks (id);

create index if not exists spent_proofs_task_id_idx on spent_proofs (task_id);
