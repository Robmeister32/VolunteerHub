-- Move volunteer scheduling policies from events to event groups.

begin;
set search_path = volunteerhub, public;

alter table event_groups
  add column if not exists movement_policy text not null default 'APPROVAL'
    check (movement_policy in ('AUTO', 'APPROVAL')),
  add column if not exists self_checkin_enabled boolean not null default false,
  add column if not exists checkin_minutes_before integer not null default 30
    check (checkin_minutes_before >= 0),
  add column if not exists checkin_minutes_after integer not null default 30
    check (checkin_minutes_after >= 0),
  add column if not exists checkin_radius_meters integer not null default 300
    check (checkin_radius_meters > 0);

update event_groups eg
set
  movement_policy = e.movement_policy,
  self_checkin_enabled = e.self_checkin_enabled,
  checkin_minutes_before = e.checkin_minutes_before,
  checkin_minutes_after = e.checkin_minutes_after,
  checkin_radius_meters = e.checkin_radius_meters
from events e
where e.id = eg.event_id;

alter table events
  drop column if exists signup_policy,
  drop column if exists movement_policy,
  drop column if exists self_checkin_enabled,
  drop column if exists checkin_minutes_before,
  drop column if exists checkin_minutes_after,
  drop column if exists checkin_radius_meters;

commit;
