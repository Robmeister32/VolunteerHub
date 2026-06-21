begin;

set search_path = volunteerhub, public;

create table tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete restrict,
  event_group_id uuid not null references event_groups(id) on delete restrict,
  title text not null,
  description text,
  location text,
  required_volunteers integer not null default 1
    check (required_volunteers > 0 and required_volunteers <= 50),
  priority text not null default 'NORMAL'
    check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'STAFFED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_by_user_id uuid references app_users(id) on delete set null,
  started_by_user_id uuid references app_users(id) on delete set null,
  completed_by_user_id uuid references app_users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table task_recipients (
  task_id uuid not null references tasks(id) on delete cascade,
  volunteer_id uuid not null references volunteer_profiles(id) on delete cascade,
  seen_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (task_id, volunteer_id)
);

create table task_claims (
  task_id uuid not null references tasks(id) on delete cascade,
  volunteer_id uuid not null references volunteer_profiles(id) on delete restrict,
  status text not null default 'CLAIMED'
    check (status in ('CLAIMED', 'WITHDRAWN')),
  claimed_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (task_id, volunteer_id)
);

create index tasks_group_status_created_idx on tasks(event_group_id, status, created_at desc);
create index task_recipients_volunteer_idx on task_recipients(volunteer_id, task_id);
create index task_claims_active_idx on task_claims(task_id, claimed_at)
  where status = 'CLAIMED';

create function ensure_task_event_group_matches_event()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from event_groups eg
    where eg.id = new.event_group_id
      and eg.event_id = new.event_id
  ) then
    raise exception 'Task event group must belong to the selected event';
  end if;
  return new;
end;
$$;

create trigger tasks_event_group_guard
before insert or update of event_id, event_group_id on tasks
for each row execute function ensure_task_event_group_matches_event();

create trigger tasks_updated_at before update on tasks
for each row execute function set_updated_at();

commit;
