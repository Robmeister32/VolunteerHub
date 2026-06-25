-- Give each application user an optional home campus for navigation identity and future personalization.

begin;

set search_path = volunteerhub, public;

alter table app_users
  add column if not exists home_campus_id uuid references campuses(id) on delete set null;

update app_users
set home_campus_id = (
  select id from campuses where is_active order by created_at, id limit 1
)
where home_campus_id is null;

create index if not exists app_users_home_campus_idx on app_users(home_campus_id);

commit;
