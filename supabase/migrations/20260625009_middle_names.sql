begin;

set search_path = volunteerhub, public;

alter table app_users
  add column if not exists middle_name text;

alter table volunteer_profiles
  add column if not exists middle_name text;

alter table household_members
  add column if not exists middle_name text;

update app_users u
set middle_name = vp.middle_name
from volunteer_profiles vp
where vp.app_user_id = u.id
  and u.middle_name is distinct from vp.middle_name;

update household_members hm
set middle_name = vp.middle_name
from volunteer_profiles vp
where vp.id = hm.volunteer_id
  and hm.middle_name is distinct from vp.middle_name;

create or replace view event_roster
with (security_invoker = true)
as
select
  a.id as assignment_id,
  eg.event_id,
  e.name as event_name,
  e.starts_at,
  eg.id as event_group_id,
  eg.name as event_group_name,
  a.volunteer_id,
  vp.first_name,
  vp.middle_name,
  vp.last_name,
  u.email,
  u.phone,
  a.status as assignment_status,
  at.status as attendance_status,
  at.checkin_at,
  a.requested_at,
  a.decided_at
from assignments a
join event_groups eg on eg.id = a.event_group_id
join events e on e.id = eg.event_id
join volunteer_profiles vp on vp.id = a.volunteer_id
left join app_users u on u.id = vp.app_user_id
left join attendance at on at.assignment_id = a.id;

create or replace view volunteer_directory
with (security_invoker = true)
as
select
  vp.id as volunteer_id,
  vp.first_name,
  vp.middle_name,
  vp.last_name,
  vp.preferred_name,
  vp.birth_date,
  vp.application_status,
  vp.is_active,
  u.id as user_id,
  u.auth_uid,
  u.email,
  u.phone,
  u.status as user_status,
  h.id as household_id,
  h.name as household_name,
  hm.relationship,
  hm.is_guardian_managed,
  vsh.scheduled_count,
  vsh.attended_count,
  vsh.last_served_at,
  vsh.next_serving_at
from volunteer_profiles vp
left join app_users u on u.id = vp.app_user_id
left join household_members hm on hm.volunteer_id = vp.id
left join households h on h.id = hm.household_id
left join volunteer_service_history vsh on vsh.volunteer_id = vp.id;

commit;
