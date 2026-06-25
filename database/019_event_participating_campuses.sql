-- Track which campuses are expected to participate in an event separately from
-- the physical event location. This supports off-site one-off events whose
-- volunteers may come from one or more nearby campuses.

begin;
set search_path = volunteerhub, public;

alter table events
  add column if not exists location_type text not null default 'CAMPUS'
    check (location_type in ('CAMPUS', 'OFF_SITE')),
  add column if not exists participating_campus_ids uuid[] not null default '{}';

update events
set participating_campus_ids = array[campus_id]
where participating_campus_ids = '{}';

create index if not exists events_participating_campuses_idx
  on events using gin(participating_campus_ids);

commit;
