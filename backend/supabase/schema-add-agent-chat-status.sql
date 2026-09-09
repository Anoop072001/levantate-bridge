-- If agent_chats already exists without status, run this once:

alter table agent_chats
  add column if not exists status text not null default 'active'
  check (status in ('active', 'idle'));
