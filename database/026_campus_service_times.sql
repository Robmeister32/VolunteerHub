begin;

set search_path = volunteerhub, public;

create table if not exists campus_service_times (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid references campuses(id) on delete cascade,
  campus_name text not null,
  service_day text not null,
  service_time time without time zone not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campus_service_times_campus_name_length check (char_length(trim(campus_name)) between 1 and 120),
  constraint campus_service_times_day_check check (
    service_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  ),
  constraint campus_service_times_unique unique (campus_name, service_day, service_time)
);

create index if not exists campus_service_times_campus_idx
  on campus_service_times(campus_id, service_day, service_time);

drop trigger if exists campus_service_times_updated_at on campus_service_times;
create trigger campus_service_times_updated_at
before update on campus_service_times
for each row execute function set_updated_at();

with service_times(campus_name, service_day, service_time) as (
  values
    ('288', 'Thursday', '19:00'::time),
    ('288', 'Sunday', '08:15'::time),
    ('288', 'Sunday', '09:45'::time),
    ('288', 'Sunday', '11:15'::time),
    ('Pearland', 'Thursday', '19:00'::time),
    ('Pearland', 'Sunday', '08:15'::time),
    ('Pearland', 'Sunday', '09:45'::time),
    ('Pearland', 'Sunday', '11:15'::time),
    ('Alvin', 'Thursday', '19:00'::time),
    ('Alvin', 'Sunday', '08:15'::time),
    ('Alvin', 'Sunday', '09:45'::time),
    ('Alvin', 'Sunday', '11:15'::time),
    ('Webster', 'Thursday', '19:00'::time),
    ('Webster', 'Sunday', '08:15'::time),
    ('Webster', 'Sunday', '09:45'::time),
    ('Webster', 'Sunday', '11:15'::time),
    ('Friendswood', 'Thursday', '19:00'::time),
    ('Friendswood', 'Sunday', '08:15'::time),
    ('Friendswood', 'Sunday', '09:45'::time),
    ('Friendswood', 'Sunday', '11:15'::time),
    ('Lake Jackson', 'Sunday', '09:45'::time),
    ('Lake Jackson', 'Sunday', '11:15'::time)
)
insert into campus_service_times(campus_id, campus_name, service_day, service_time)
select c.id, st.campus_name, st.service_day, st.service_time
from service_times st
left join campuses c on c.name = st.campus_name
on conflict (campus_name, service_day, service_time) do update
set campus_id = coalesce(excluded.campus_id, campus_service_times.campus_id);

comment on table campus_service_times is 'Scheduled service times by campus.';
comment on column campus_service_times.campus_name is 'Campus display name captured from the service-times source list.';
comment on column campus_service_times.campus_id is 'Optional link to campuses when the campus exists in VolunteerHub.';

commit;
