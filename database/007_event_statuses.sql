-- Replace the legacy published/completed event lifecycle with explicit administration statuses.

begin;
set search_path = volunteerhub, public;

alter table events drop constraint if exists events_status_check;

update events set status = 'ACTIVE' where status = 'PUBLISHED';
update events set status = 'COMPLETE' where status = 'COMPLETED';

alter table events alter column status set default 'DRAFT';
alter table events
  add constraint events_status_check
  check (status in ('ACTIVE', 'COMPLETE', 'DRAFT', 'CANCELLED', 'REMOVED'));

drop index if exists events_upcoming_idx;
create index events_upcoming_idx on events(starts_at) where status = 'ACTIVE';

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
