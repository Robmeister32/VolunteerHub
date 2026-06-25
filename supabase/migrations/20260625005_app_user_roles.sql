-- Allow an application user to hold multiple system roles.

begin;
set search_path = volunteerhub, public;

alter table app_users
  add column if not exists roles text[] not null default array['VOLUNTEER']::text[];

update app_users
set roles = case global_role
  when 'ADMIN' then array['ADMIN']::text[]
  when 'LEADER' then array['EVENT_LEADER']::text[]
  else array['VOLUNTEER']::text[]
end
where global_role is not null;

alter table app_users
  add constraint app_users_roles_valid check (
    cardinality(roles) > 0
    and roles <@ array['ADMIN', 'EVENT_LEADER', 'VOLUNTEER']::text[]
  );

create index if not exists app_users_roles_idx on app_users using gin(roles);

alter table app_users drop column global_role;

commit;
