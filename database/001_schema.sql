-- VolunteerHub production schema for PostgreSQL / Supabase.
-- Authentication is owned by Firebase. This database stores authorization and domain data.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create schema if not exists volunteerhub;
set search_path = volunteerhub, public;

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_uid text not null unique,
  email citext not null unique,
  phone text,
  display_name text,
  home_campus_id uuid,
  middle_name text,
  global_role text not null default 'VOLUNTEER'
    check (global_role in ('ADMIN', 'LEADER', 'VOLUNTEER')),
  status text not null default 'ACTIVE'
    check (status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  region text not null,
  postal_code text not null,
  country_code char(2) not null default 'US',
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  timezone text not null default 'America/Chicago',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

alter table app_users
  add constraint app_users_home_campus_fk
  foreign key (home_campus_id) references campuses(id) on delete set null;

create table ministries (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references campuses(id) on delete restrict,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, name)
);

create table ministry_roles (
  id uuid primary key default gen_random_uuid(),
  ministry_id uuid not null references ministries(id) on delete cascade,
  name text not null,
  description text,
  minimum_age smallint not null default 0 check (minimum_age between 0 and 120),
  maximum_age smallint check (maximum_age between 0 and 120),
  requires_admin_approval boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maximum_age is null or maximum_age >= minimum_age),
  unique (ministry_id, name),
  unique (id, ministry_id)
);

create table leader_ministries (
  user_id uuid not null references app_users(id) on delete cascade,
  ministry_id uuid not null references ministries(id) on delete cascade,
  assigned_by uuid references app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, ministry_id)
);

create table volunteer_profiles (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid unique references app_users(id) on delete set null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  preferred_name text,
  birth_date date,
  profile_photo_path text,
  emergency_contact_name text,
  emergency_contact_phone text,
  application_status text not null default 'DRAFT'
    check (application_status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  application_submitted_at timestamptz,
  application_decided_at timestamptz,
  application_decided_by uuid references app_users(id) on delete set null,
  application_decision_reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table notification_preferences (
  volunteer_id uuid primary key references volunteer_profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  reminder_hours_before integer[] not null default array[24],
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  volunteer_id uuid not null unique references volunteer_profiles(id) on delete cascade,
  middle_name text,
  relationship text not null,
  is_guardian_managed boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (household_id, volunteer_id)
);

create table guardian_authorizations (
  guardian_volunteer_id uuid not null references volunteer_profiles(id) on delete cascade,
  dependent_volunteer_id uuid not null references volunteer_profiles(id) on delete cascade,
  authorized_by uuid references app_users(id) on delete set null,
  status text not null default 'ACTIVE'
    check (status in ('PENDING', 'ACTIVE', 'REVOKED')),
  authorized_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (guardian_volunteer_id, dependent_volunteer_id),
  check (guardian_volunteer_id <> dependent_volunteer_id)
);

create table consents (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer_profiles(id) on delete cascade,
  consent_type text not null
    check (consent_type in ('TERMS', 'PRIVACY', 'SMS', 'BACKGROUND_CHECK', 'DEPENDENT_PARTICIPATION')),
  version text not null,
  granted boolean not null,
  guardian_volunteer_id uuid references volunteer_profiles(id) on delete set null,
  ip_address inet,
  user_agent text,
  recorded_at timestamptz not null default now()
);

create table requirement_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  requirement_type text not null
    check (requirement_type in ('BACKGROUND_CHECK', 'TRAINING', 'DOCUMENT', 'AGE_RULE', 'ADMIN_APPROVAL')),
  description text,
  validity_days integer check (validity_days is null or validity_days > 0),
  external_provider text,
  instructions_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table role_requirements (
  role_id uuid not null references ministry_roles(id) on delete cascade,
  requirement_id uuid not null references requirement_definitions(id) on delete restrict,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role_id, requirement_id)
);

create table volunteer_requirement_records (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer_profiles(id) on delete cascade,
  requirement_id uuid not null references requirement_definitions(id) on delete restrict,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SUBMITTED', 'COMPLETE', 'REJECTED', 'EXPIRED', 'WAIVED')),
  provider_reference text,
  storage_bucket text,
  storage_path text,
  completed_at timestamptz,
  expires_at timestamptz,
  reviewed_by uuid references app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((storage_bucket is null) = (storage_path is null))
);

create table volunteer_role_eligibility (
  volunteer_id uuid not null references volunteer_profiles(id) on delete cascade,
  role_id uuid not null references ministry_roles(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SUSPENDED', 'EXPIRED')),
  reason text,
  decided_by uuid references app_users(id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (volunteer_id, role_id)
);

create table event_series (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references campuses(id) on delete restrict,
  ministry_id uuid not null references ministries(id) on delete restrict,
  name text not null,
  recurrence_rule text,
  timezone text not null default 'America/Chicago',
  is_active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references event_series(id) on delete set null,
  campus_id uuid not null references campuses(id) on delete restrict,
  ministry_id uuid not null references ministries(id) on delete restrict,
  name text not null,
  description text,
  instructions text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  address text,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  signup_policy text not null default 'APPROVAL'
    check (signup_policy in ('AUTO', 'APPROVAL')),
  movement_policy text not null default 'APPROVAL'
    check (movement_policy in ('AUTO', 'APPROVAL')),
  signup_deadline timestamptz,
  cancellation_deadline timestamptz,
  change_deadline timestamptz,
  self_checkin_enabled boolean not null default false,
  checkin_minutes_before integer not null default 30 check (checkin_minutes_before >= 0),
  checkin_minutes_after integer not null default 30 check (checkin_minutes_after >= 0),
  checkin_radius_meters integer not null default 300 check (checkin_radius_meters > 0),
  status text not null default 'DRAFT'
    check (status in ('ACTIVE', 'COMPLETE', 'DRAFT', 'CANCELLED', 'REMOVED')),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((latitude is null) = (longitude is null)),
  unique (id, ministry_id)
);

create table event_leaders (
  event_id uuid not null references events(id) on delete cascade,
  leader_user_id uuid not null references app_users(id) on delete cascade,
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (event_id, leader_user_id)
);

create table event_requirements (
  event_id uuid not null references events(id) on delete cascade,
  role_id uuid not null references ministry_roles(id) on delete restrict,
  required_count integer not null check (required_count > 0),
  waitlist_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (event_id, role_id)
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  role_id uuid not null,
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
  updated_at timestamptz not null default now(),
  foreign key (event_id, role_id) references event_requirements(event_id, role_id) on delete restrict
);

create table assignment_change_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  request_type text not null
    check (request_type in ('CANCEL', 'MOVE', 'SWAP')),
  target_event_id uuid references events(id) on delete restrict,
  target_role_id uuid references ministry_roles(id) on delete restrict,
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
    (request_type = 'CANCEL' and target_event_id is null and target_role_id is null and target_volunteer_id is null)
    or (request_type = 'MOVE' and target_event_id is not null and target_role_id is not null and target_volunteer_id is null)
    or (request_type = 'SWAP' and target_event_id is not null and target_role_id is not null and target_volunteer_id is not null)
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

create table device_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  platform text not null check (platform in ('IOS', 'ANDROID', 'WEB')),
  push_token text not null unique,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references app_users(id) on delete restrict,
  ministry_id uuid references ministries(id) on delete restrict,
  event_id uuid references events(id) on delete restrict,
  subject text not null,
  message text not null,
  channels text[] not null,
  audience_filter jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'QUEUED', 'SENDING', 'COMPLETE', 'FAILED', 'CANCELLED')),
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channels <@ array['PUSH', 'EMAIL', 'SMS']::text[] and cardinality(channels) > 0)
);

create table broadcast_deliveries (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  recipient_user_id uuid not null references app_users(id) on delete cascade,
  channel text not null check (channel in ('PUSH', 'EMAIL', 'SMS')),
  destination_masked text,
  provider_message_id text,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED', 'UNSUBSCRIBED')),
  failure_reason text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broadcast_id, recipient_user_id, channel)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete restrict,
  volunteer_id uuid not null references volunteer_profiles(id) on delete restrict,
  leader_user_id uuid not null references app_users(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, volunteer_id, leader_user_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_user_id uuid not null references app_users(id) on delete restrict,
  body text not null,
  channel text not null default 'SMS' check (channel in ('SMS', 'IN_APP')),
  provider_message_id text,
  delivery_status text not null default 'QUEUED'
    check (delivery_status in ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')),
  failure_reason text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED', 'CANCELLED')),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  occurred_at timestamptz not null default now()
);

create unique index assignments_one_active_per_event_volunteer
  on assignments(event_id, volunteer_id)
  where status in ('REQUESTED', 'WAITLISTED', 'CONFIRMED');

create unique index assignment_change_requests_one_pending
  on assignment_change_requests(assignment_id)
  where status = 'REQUESTED';

create unique index volunteer_requirement_records_one_current
  on volunteer_requirement_records(volunteer_id, requirement_id)
  where status in ('PENDING', 'SUBMITTED', 'COMPLETE', 'WAIVED');

create index app_users_auth_uid_idx on app_users(auth_uid);
create index app_users_home_campus_idx on app_users(home_campus_id);
create index events_name_search_idx on events using gin(name gin_trgm_ops);
create index events_description_search_idx on events using gin(description gin_trgm_ops);
create index events_address_search_idx on events using gin(address gin_trgm_ops);
create index campuses_name_search_idx on campuses using gin(name gin_trgm_ops);
create index event_groups_name_search_idx on event_groups using gin(name gin_trgm_ops);
create index volunteer_profiles_first_name_search_idx on volunteer_profiles using gin(first_name gin_trgm_ops);
create index volunteer_profiles_last_name_search_idx on volunteer_profiles using gin(last_name gin_trgm_ops);
create index volunteer_profiles_preferred_name_search_idx on volunteer_profiles using gin(preferred_name gin_trgm_ops);
create index volunteer_profiles_name_idx on volunteer_profiles(last_name, first_name);
create index volunteer_profiles_application_idx on volunteer_profiles(application_status);
create index leader_ministries_ministry_idx on leader_ministries(ministry_id);
create index consents_volunteer_type_idx on consents(volunteer_id, consent_type, recorded_at desc);
create index role_requirements_requirement_idx on role_requirements(requirement_id);
create index requirement_records_expiration_idx on volunteer_requirement_records(expires_at)
  where expires_at is not null;
create index requirement_records_volunteer_idx on volunteer_requirement_records(volunteer_id, status);
create index eligibility_role_status_idx on volunteer_role_eligibility(role_id, status);
create index events_upcoming_idx on events(starts_at) where status = 'ACTIVE';
create index events_ministry_starts_idx on events(ministry_id, starts_at);
create index assignments_event_status_idx on assignments(event_id, status);
create index assignments_volunteer_status_idx on assignments(volunteer_id, status);
create index broadcasts_status_schedule_idx on broadcasts(status, scheduled_for);
create index broadcast_deliveries_status_idx on broadcast_deliveries(status);
create index messages_conversation_created_idx on messages(conversation_id, created_at);
create index outbox_jobs_ready_idx on outbox_jobs(status, available_at) where status = 'PENDING';
create index audit_logs_entity_idx on audit_logs(entity_type, entity_id, occurred_at desc);
create index audit_logs_actor_idx on audit_logs(actor_user_id, occurred_at desc);

create function ensure_event_role_matches_ministry()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from events e
    join ministry_roles mr on mr.id = new.role_id
    where e.id = new.event_id
      and e.ministry_id = mr.ministry_id
  ) then
    raise exception 'Event requirement role must belong to the event ministry';
  end if;
  return new;
end;
$$;

create trigger event_requirements_role_ministry_guard
before insert or update on event_requirements
for each row execute function ensure_event_role_matches_ministry();

create function create_assignment_attendance()
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

create trigger app_users_updated_at before update on app_users
for each row execute function set_updated_at();
create trigger campuses_updated_at before update on campuses
for each row execute function set_updated_at();
create trigger ministries_updated_at before update on ministries
for each row execute function set_updated_at();
create trigger ministry_roles_updated_at before update on ministry_roles
for each row execute function set_updated_at();
create trigger volunteer_profiles_updated_at before update on volunteer_profiles
for each row execute function set_updated_at();
create trigger notification_preferences_updated_at before update on notification_preferences
for each row execute function set_updated_at();
create trigger households_updated_at before update on households
for each row execute function set_updated_at();
create trigger requirement_definitions_updated_at before update on requirement_definitions
for each row execute function set_updated_at();
create trigger requirement_records_updated_at before update on volunteer_requirement_records
for each row execute function set_updated_at();
create trigger eligibility_updated_at before update on volunteer_role_eligibility
for each row execute function set_updated_at();
create trigger event_series_updated_at before update on event_series
for each row execute function set_updated_at();
create trigger events_updated_at before update on events
for each row execute function set_updated_at();
create trigger assignments_updated_at before update on assignments
for each row execute function set_updated_at();
create trigger assignment_change_requests_updated_at before update on assignment_change_requests
for each row execute function set_updated_at();
create trigger attendance_updated_at before update on attendance
for each row execute function set_updated_at();
create trigger device_registrations_updated_at before update on device_registrations
for each row execute function set_updated_at();
create trigger broadcasts_updated_at before update on broadcasts
for each row execute function set_updated_at();
create trigger broadcast_deliveries_updated_at before update on broadcast_deliveries
for each row execute function set_updated_at();
create trigger conversations_updated_at before update on conversations
for each row execute function set_updated_at();
create trigger outbox_jobs_updated_at before update on outbox_jobs
for each row execute function set_updated_at();

-- Keep the application schema private from Supabase's client-facing roles.
revoke all on schema volunteerhub from public;
revoke all on all tables in schema volunteerhub from public;
revoke all on all sequences in schema volunteerhub from public;
revoke all on all functions in schema volunteerhub from public;
alter default privileges in schema volunteerhub revoke all on tables from public;
alter default privileges in schema volunteerhub revoke all on sequences from public;
alter default privileges in schema volunteerhub revoke execute on functions from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema volunteerhub from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema volunteerhub from authenticated';
  end if;
end;
$$;

commit;
