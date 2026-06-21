-- Track the last time each conversation participant read a thread.

begin;
set search_path = volunteerhub, public;

create table if not exists conversation_read_states (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_read_states_user_idx
  on conversation_read_states(user_id, last_read_at);

commit;
