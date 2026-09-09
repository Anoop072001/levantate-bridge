-- Run once in Supabase SQL editor (Storage → Policies can also be set in dashboard).
-- Backend uploads with the service role; workers never get direct bucket access.

insert into storage.buckets (id, name, public)
values ('proof-files', 'proof-files', false)
on conflict (id) do nothing;
