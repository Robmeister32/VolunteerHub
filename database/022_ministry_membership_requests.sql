-- Add ministry membership request workflow and campus-scoped memberships.

begin;
set search_path = volunteerhub, public;

alter table user_ministry_memberships
  add column if not exists campus_id uuid references campuses(id) on delete set null;

create index if not exists user_ministry_memberships_campus_idx
  on user_ministry_memberships(campus_id, ministry_id);

create table if not exists ministry_membership_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  volunteer_id uuid references volunteer_profiles(id) on delete set null,
  ministry_id uuid not null references ministries(id) on delete cascade,
  campus_id uuid not null references campuses(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED')),
  requested_at timestamptz not null default now(),
  decided_by uuid references app_users(id) on delete set null,
  decided_at timestamptz,
  decision_reason text
);

create unique index if not exists ministry_membership_requests_one_pending_idx
  on ministry_membership_requests(user_id, ministry_id)
  where status = 'PENDING';

create unique index if not exists ministry_membership_requests_one_per_ministry_idx
  on ministry_membership_requests(user_id, ministry_id);

create index if not exists ministry_membership_requests_scope_idx
  on ministry_membership_requests(ministry_id, campus_id, status, requested_at desc);

create index if not exists ministry_membership_requests_user_idx
  on ministry_membership_requests(user_id, requested_at desc);

comment on column user_ministry_memberships.campus_id is 'Campus selected for the user ministry membership, usually set by an approved request.';
comment on table ministry_membership_requests is 'Volunteer requests to join one ministry at one campus, approved by ministry heads or campus ministry leads.';

commit;
