-- Replace app_users.roles with an extensible role catalog and assignments.

begin;
set search_path = volunteerhub, public;

create table roles (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into roles(code, name, description)
values
  ('ADMIN', 'Administrator', 'Church-wide administration and configuration access.'),
  ('EVENT_LEADER', 'Event Leader', 'Event roster, approval, attendance, and communication access.'),
  ('TEAM_LEADER', 'Team Leader', 'Event team staffing, approval, and communication access.'),
  ('VOLUNTEER', 'Volunteer', 'Volunteer profile, signup, schedule, and communication access.');

create table app_user_roles (
  user_id uuid not null references app_users(id) on delete cascade,
  role_code text not null references roles(code) on delete restrict,
  assigned_by uuid references app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_code)
);

insert into app_user_roles(user_id, role_code)
select u.id, role_code
from app_users u
cross join lateral unnest(u.roles) role_code;

create index app_user_roles_role_idx on app_user_roles(role_code, user_id);

create trigger roles_updated_at before update on roles
for each row execute function set_updated_at();

drop index if exists app_users_roles_idx;
alter table app_users drop column roles;

commit;
