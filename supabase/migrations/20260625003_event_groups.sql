-- Migrate scheduling from ministry-role signup to simplified event-group signup.

begin;
set search_path = volunteerhub, public;

create table if not exists event_groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  description text,
  instructions text,
  leader_user_ids uuid[] not null default '{}',
  required_volunteer_count integer not null default 0
    check (required_volunteer_count >= 0),
  signup_policy text not null default 'APPROVAL'
    check (signup_policy in ('AUTO', 'APPROVAL')),
  movement_policy text not null default 'APPROVAL'
    check (movement_policy in ('AUTO', 'APPROVAL')),
  self_checkin_enabled boolean not null default false,
  checkin_minutes_before integer not null default 30
    check (checkin_minutes_before >= 0),
  checkin_minutes_after integer not null default 30
    check (checkin_minutes_after >= 0),
  checkin_radius_meters integer not null default 300
    check (checkin_radius_meters > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name)
);

drop view if exists dashboard_metrics;
drop view if exists volunteer_directory;
drop view if exists volunteer_service_history;
drop view if exists event_roster;
drop view if exists event_role_staffing;
drop view if exists event_staffing_summary;

drop trigger if exists event_requirements_role_ministry_guard on event_requirements;
drop function if exists ensure_event_role_matches_ministry();

drop table if exists attendance;
drop table if exists assignment_change_requests;
drop table if exists assignments;
drop table if exists event_requirements;
drop table if exists event_leaders;

drop index if exists events_ministry_starts_idx;

alter table events
  drop column if exists series_id,
  drop column if exists ministry_id,
  add column if not exists event_leader_user_ids uuid[] not null default '{}';

drop table if exists event_series;

alter table broadcasts
  add column if not exists event_group_id uuid references event_groups(id) on delete restrict;

alter table conversations
  add column if not exists event_group_id uuid references event_groups(id) on delete restrict;

create table assignments (
  id uuid primary key default gen_random_uuid(),
  event_group_id uuid not null references event_groups(id) on delete restrict,
  volunteer_id uuid not null references volunteer_profiles(id) on delete restrict,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'WAITLISTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  source text not null default 'VOLUNTEER'
    check (source in ('VOLUNTEER', 'GUARDIAN', 'LEADER', 'ADMIN', 'MOVE', 'SWAP')),
  requested_by uuid references app_users(id) on delete set null,
  decided_by uuid references app_users(id) on delete set null,
  decision_reason text,
  previous_assignment_id uuid references assignments(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table assignment_change_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  request_type text not null check (request_type in ('CANCEL', 'MOVE', 'SWAP')),
  target_event_group_id uuid references event_groups(id) on delete restrict,
  target_volunteer_id uuid references volunteer_profiles(id) on delete restrict,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by uuid not null references app_users(id) on delete restrict,
  decided_by uuid references app_users(id) on delete set null,
  decision_reason text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (request_type = 'CANCEL' and target_event_group_id is null and target_volunteer_id is null)
    or (request_type = 'MOVE' and target_event_group_id is not null and target_volunteer_id is null)
    or (request_type = 'SWAP' and target_event_group_id is not null and target_volunteer_id is not null)
  )
);

create table attendance (
  assignment_id uuid primary key references assignments(id) on delete cascade,
  status text not null default 'NOT_RECORDED'
    check (status in ('NOT_RECORDED', 'CHECKED_IN', 'PRESENT', 'ABSENT', 'EXCUSED')),
  checkin_at timestamptz,
  checkin_latitude numeric(9, 6) check (checkin_latitude between -90 and 90),
  checkin_longitude numeric(9, 6) check (checkin_longitude between -180 and 180),
  recorded_by uuid references app_users(id) on delete set null,
  notes text,
  updated_at timestamptz not null default now(),
  check ((checkin_latitude is null) = (checkin_longitude is null))
);

create unique index if not exists assignments_one_active_per_group_volunteer
  on assignments(event_group_id, volunteer_id)
  where status in ('REQUESTED', 'WAITLISTED', 'CONFIRMED');
create unique index if not exists assignment_change_requests_one_pending
  on assignment_change_requests(assignment_id)
  where status = 'REQUESTED';
create index if not exists event_groups_event_idx on event_groups(event_id, is_active);
create index if not exists event_groups_leaders_idx on event_groups using gin(leader_user_ids);
create index if not exists events_leaders_idx on events using gin(event_leader_user_ids);
create index if not exists assignments_group_status_idx on assignments(event_group_id, status);
create index if not exists assignments_volunteer_status_idx on assignments(volunteer_id, status);

drop trigger if exists event_groups_updated_at on event_groups;
create trigger event_groups_updated_at before update on event_groups
for each row execute function set_updated_at();
create trigger assignments_updated_at before update on assignments
for each row execute function set_updated_at();
create trigger assignment_change_requests_updated_at before update on assignment_change_requests
for each row execute function set_updated_at();
create trigger attendance_updated_at before update on attendance
for each row execute function set_updated_at();

create or replace function create_assignment_attendance()
returns trigger
language plpgsql
as $$
begin
  insert into attendance(assignment_id) values (new.id);
  return new;
end;
$$;

create trigger assignments_create_attendance
after insert on assignments
for each row execute function create_assignment_attendance();

create or replace view event_group_staffing
with (security_invoker = true)
as
select
  eg.id as event_group_id,
  eg.event_id,
  eg.name as event_group_name,
  eg.required_volunteer_count as required_count,
  count(a.id) filter (where a.status = 'CONFIRMED')::integer as confirmed_count,
  greatest(eg.required_volunteer_count - count(a.id) filter (where a.status = 'CONFIRMED'), 0)::integer as open_count,
  count(a.id) filter (where a.status = 'REQUESTED')::integer as pending_count,
  count(a.id) filter (where a.status = 'WAITLISTED')::integer as waitlisted_count
from event_groups eg
left join assignments a on a.event_group_id = eg.id
where eg.is_active
group by eg.id;

create or replace view event_staffing_summary
with (security_invoker = true)
as
select
  e.id as event_id,
  e.name as event_name,
  e.campus_id,
  c.name as campus_name,
  e.starts_at,
  e.ends_at,
  e.status as event_status,
  coalesce(sum(egs.required_count), 0)::integer as required_count,
  coalesce(sum(egs.confirmed_count), 0)::integer as confirmed_count,
  coalesce(sum(egs.open_count), 0)::integer as open_count,
  coalesce(sum(egs.pending_count), 0)::integer as pending_count,
  coalesce(sum(egs.waitlisted_count), 0)::integer as waitlisted_count
from events e
join campuses c on c.id = e.campus_id
left join event_group_staffing egs on egs.event_id = e.id
group by e.id, c.name;

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

create or replace view volunteer_service_history
with (security_invoker = true)
as
select
  vp.id as volunteer_id,
  vp.first_name,
  vp.middle_name,
  vp.last_name,
  count(a.id) filter (where a.status in ('COMPLETED', 'CONFIRMED'))::integer as scheduled_count,
  count(a.id) filter (where at.status in ('CHECKED_IN', 'PRESENT'))::integer as attended_count,
  count(a.id) filter (where a.status = 'NO_SHOW' or at.status = 'ABSENT')::integer as missed_count,
  max(e.starts_at) filter (where at.status in ('CHECKED_IN', 'PRESENT')) as last_served_at,
  min(e.starts_at) filter (where e.starts_at > now() and a.status = 'CONFIRMED') as next_serving_at
from volunteer_profiles vp
left join assignments a on a.volunteer_id = vp.id
left join event_groups eg on eg.id = a.event_group_id
left join events e on e.id = eg.event_id
left join attendance at on at.assignment_id = a.id
group by vp.id;

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

create or replace view dashboard_metrics
with (security_invoker = true)
as
select
  (select count(*) from events where starts_at > now() and status = 'ACTIVE')::integer as upcoming_events,
  (select count(*) from volunteer_profiles where application_status = 'SUBMITTED')::integer as pending_applications,
  (select count(*) from assignments where status = 'REQUESTED')::integer as pending_assignments,
  (select count(*) from expiring_requirements)::integer as expiring_requirements,
  (select coalesce(sum(open_count), 0) from event_staffing_summary where starts_at > now() and event_status = 'ACTIVE')::integer as open_positions;

commit;
