begin;

set search_path = volunteerhub, public;

create table if not exists user_recurring_volunteer_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  campus_service_time_id uuid not null references campus_service_times(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_recurring_volunteer_schedules_unique unique (user_id, campus_service_time_id)
);

create index if not exists user_recurring_volunteer_schedules_user_idx
  on user_recurring_volunteer_schedules(user_id, created_at);

create index if not exists user_recurring_volunteer_schedules_service_time_idx
  on user_recurring_volunteer_schedules(campus_service_time_id, user_id);

drop trigger if exists user_recurring_volunteer_schedules_updated_at on user_recurring_volunteer_schedules;
create trigger user_recurring_volunteer_schedules_updated_at
before update on user_recurring_volunteer_schedules
for each row execute function set_updated_at();

comment on table user_recurring_volunteer_schedules is 'Recurring volunteer service schedule preferences selected from campus service times.';

commit;
