begin;
set search_path = volunteerhub, public;

create table event_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  event_leader_user_ids uuid[] not null default '{}',
  teams jsonb not null default '[]'::jsonb,
  created_by uuid not null references app_users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_templates_name_length check (char_length(trim(name)) between 2 and 160),
  constraint event_templates_description_length check (char_length(description) <= 4000),
  constraint event_templates_teams_array check (jsonb_typeof(teams) = 'array')
);

create index event_templates_created_by_idx on event_templates(created_by);
create index event_templates_active_idx on event_templates(is_active, updated_at desc);

create trigger event_templates_updated_at
before update on event_templates
for each row execute function set_updated_at();

commit;
