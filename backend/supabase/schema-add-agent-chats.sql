-- Agent console: multiple persisted chat sessions (run in Supabase SQL editor).

create table if not exists agent_chats (
  id         uuid        primary key default gen_random_uuid(),
  title      text        not null default 'New chat',
  status     text        not null default 'active' check (status in ('active', 'idle')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_chat_messages (
  id         uuid        primary key default gen_random_uuid(),
  chat_id    uuid        not null references agent_chats (id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null,
  steps      jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_chat_messages_chat_id_idx
  on agent_chat_messages (chat_id, created_at);
