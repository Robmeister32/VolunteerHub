-- VolunteerHub operational and reporting views.

begin;
set search_path = volunteerhub, public;

create or replace view event_staffing_summary
with (security_invoker = true)
as
select
  e.id as event_id,
  e.name as event_name,
  e.campus_id,
  c.name as campus_name,
  e.ministry_id,
  m.name as ministry_name,
  e.starts_at,
  e.ends_at,
  e.status as event_status,
  coalesce(staffing.required_count, 0)::integer as required_count,
  coalesce(staffing.confirmed_count, 0)::integer as confirmed_count,
  greatest(coalesce(staffing.required_count, 0) - coalesce(staffing.confirmed_count, 0), 0)::integer as open_count,
  coalesce(staffing.pending_count, 0)::integer as pending_count,
  coalesce(staffing.waitlisted_count, 0)::integer as waitlisted_count
from events e
join campuses c on c.id = e.campus_id
join ministries m on m.id = e.ministry_id
left join lateral (
  select
    (select coalesce(sum(er.required_count), 0) from event_requirements er where er.event_id = e.id) as required_count,
    count(a.id) filter (where a.status = 'CONFIRMED') as confirmed_count,
    count(a.id) filter (where a.status = 'REQUESTED') as pending_count,
    count(a.id) filter (where a.status = 'WAITLISTED') as waitlisted_count
  from assignments a
  where a.event_id = e.id
) staffing on true;

create or replace view event_role_staffing
with (security_invoker = true)
as
select
  er.event_id,
  e.name as event_name,
  er.role_id,
  mr.name as role_name,
  er.required_count,
  count(a.id) filter (where a.status = 'CONFIRMED')::integer as confirmed_count,
  greatest(er.required_count - count(a.id) filter (where a.status = 'CONFIRMED'), 0)::integer as open_count,
  count(a.id) filter (where a.status = 'REQUESTED')::integer as pending_count
from event_requirements er
join events e on e.id = er.event_id
join ministry_roles mr on mr.id = er.role_id
left join assignments a on a.event_id = er.event_id and a.role_id = er.role_id
group by er.event_id, e.name, er.role_id, mr.name, er.required_count;

create or replace view event_roster
with (security_invoker = true)
as
select
  a.id as assignment_id,
  a.event_id,
  e.name as event_name,
  e.starts_at,
  e.ministry_id,
  a.role_id,
  mr.name as role_name,
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
join events e on e.id = a.event_id
join ministry_roles mr on mr.id = a.role_id
join volunteer_profiles vp on vp.id = a.volunteer_id
left join app_users u on u.id = vp.app_user_id
left join attendance at on at.assignment_id = a.id;

create or replace view volunteer_requirement_status
with (security_invoker = true)
as
select
  vp.id as volunteer_id,
  vp.first_name,
  vp.middle_name,
  vp.last_name,
  rd.id as requirement_id,
  rd.name as requirement_name,
  rd.requirement_type,
  vrr.status,
  vrr.completed_at,
  vrr.expires_at,
  case
    when vrr.id is null then 'MISSING'
    when vrr.status = 'COMPLETE' and vrr.expires_at is not null and vrr.expires_at <= now() then 'EXPIRED'
    when vrr.status = 'COMPLETE' and vrr.expires_at is not null and vrr.expires_at <= now() + interval '60 days' then 'EXPIRING'
    else vrr.status
  end as effective_status
from volunteer_profiles vp
cross join requirement_definitions rd
left join lateral (
  select r.*
  from volunteer_requirement_records r
  where r.volunteer_id = vp.id
    and r.requirement_id = rd.id
  order by r.created_at desc
  limit 1
) vrr on true
where rd.is_active;

create or replace view volunteer_role_readiness
with (security_invoker = true)
as
select
  vp.id as volunteer_id,
  vp.first_name,
  vp.last_name,
  mr.id as role_id,
  mr.name as role_name,
  mr.ministry_id,
  vp.application_status,
  vre.status as explicit_eligibility_status,
  extract(year from age(current_date, vp.birth_date))::integer as age,
  count(rr.requirement_id)::integer as required_requirement_count,
  count(rr.requirement_id) filter (
    where latest_record.id is null
      or latest_record.status not in ('COMPLETE', 'WAIVED')
      or (latest_record.expires_at is not null and latest_record.expires_at <= now())
  )::integer as unmet_requirement_count,
  (
    vp.application_status = 'APPROVED'
    and vp.is_active
    and vp.birth_date is not null
    and extract(year from age(current_date, vp.birth_date)) >= mr.minimum_age
    and (mr.maximum_age is null or extract(year from age(current_date, vp.birth_date)) <= mr.maximum_age)
    and coalesce(vre.status, 'PENDING') not in ('INELIGIBLE', 'SUSPENDED', 'EXPIRED')
    and count(rr.requirement_id) filter (
      where latest_record.id is null
        or latest_record.status not in ('COMPLETE', 'WAIVED')
        or (latest_record.expires_at is not null and latest_record.expires_at <= now())
    ) = 0
  ) as is_ready
from volunteer_profiles vp
cross join ministry_roles mr
left join volunteer_role_eligibility vre
  on vre.volunteer_id = vp.id and vre.role_id = mr.id
left join role_requirements rr
  on rr.role_id = mr.id and rr.is_required
left join lateral (
  select vrr.*
  from volunteer_requirement_records vrr
  where vrr.volunteer_id = vp.id
    and vrr.requirement_id = rr.requirement_id
  order by vrr.created_at desc
  limit 1
) latest_record on true
where mr.is_active
group by vp.id, mr.id, vre.status;

create or replace view expiring_requirements
with (security_invoker = true)
as
select
  vrr.id as record_id,
  vrr.volunteer_id,
  vp.first_name,
  vp.last_name,
  u.email,
  rd.id as requirement_id,
  rd.name as requirement_name,
  rd.requirement_type,
  vrr.expires_at,
  (vrr.expires_at::date - current_date) as days_remaining
from volunteer_requirement_records vrr
join volunteer_profiles vp on vp.id = vrr.volunteer_id
left join app_users u on u.id = vp.app_user_id
join requirement_definitions rd on rd.id = vrr.requirement_id
where vrr.status = 'COMPLETE'
  and vrr.expires_at between now() and now() + interval '60 days';

create or replace view volunteer_service_history
with (security_invoker = true)
as
select
  vp.id as volunteer_id,
  vp.first_name,
  vp.last_name,
  count(a.id) filter (where a.status in ('COMPLETED', 'CONFIRMED'))::integer as scheduled_count,
  count(a.id) filter (where at.status in ('CHECKED_IN', 'PRESENT'))::integer as attended_count,
  count(a.id) filter (where a.status = 'NO_SHOW' or at.status = 'ABSENT')::integer as missed_count,
  max(e.starts_at) filter (where at.status in ('CHECKED_IN', 'PRESENT')) as last_served_at,
  min(e.starts_at) filter (where e.starts_at > now() and a.status = 'CONFIRMED') as next_serving_at
from volunteer_profiles vp
left join assignments a on a.volunteer_id = vp.id
left join events e on e.id = a.event_id
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

comment on view event_staffing_summary is 'One row per event with required, confirmed, pending, and open volunteer counts.';
comment on view event_roster is 'Leader/admin roster projection containing volunteer contact data.';
comment on view volunteer_requirement_status is 'Requirement matrix used to explain missing or expiring compliance.';
comment on view volunteer_role_readiness is 'Calculated volunteer readiness by ministry role; FastAPI must still revalidate before assignment.';
comment on view volunteer_directory is 'Admin/leader directory projection; contains personal data and must remain server-side.';

commit;
