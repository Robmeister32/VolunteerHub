-- Make ministries global, move user ministry membership to profiles, and add
-- campus-specific ministry lead assignments.

begin;
set search_path = volunteerhub, public;

create table if not exists user_ministry_memberships (
  user_id uuid not null references app_users(id) on delete cascade,
  ministry_id uuid not null references ministries(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, ministry_id)
);

create table if not exists ministry_campus_leads (
  ministry_id uuid not null references ministries(id) on delete cascade,
  campus_id uuid not null references campuses(id) on delete cascade,
  lead_user_id uuid not null references app_users(id) on delete cascade,
  assigned_by uuid references app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (ministry_id, campus_id)
);

insert into user_ministry_memberships(user_id, ministry_id)
select user_id, ministry_id
from leader_ministries
on conflict do nothing;

-- Keep one Ministry Head per ministry. If historical data has multiple leaders,
-- retain the earliest assignment after preserving everyone in memberships.
with ranked_heads as (
  select user_id, ministry_id,
    row_number() over (partition by ministry_id order by assigned_at, user_id) as row_number
  from leader_ministries
)
delete from leader_ministries lm
using ranked_heads rh
where lm.user_id = rh.user_id
  and lm.ministry_id = rh.ministry_id
  and rh.row_number > 1;

create unique index if not exists leader_ministries_one_head_idx
  on leader_ministries(ministry_id);

insert into user_ministry_memberships(user_id, ministry_id)
select distinct vp.app_user_id, mr.ministry_id
from volunteer_role_eligibility vre
join volunteer_profiles vp on vp.id = vre.volunteer_id
join ministry_roles mr on mr.id = vre.role_id
where vp.app_user_id is not null
  and vre.status in ('PENDING', 'ELIGIBLE')
on conflict do nothing;

insert into ministry_campus_leads(ministry_id, campus_id, lead_user_id, assigned_by, assigned_at)
select m.id, m.campus_id, lm.user_id, lm.assigned_by, lm.assigned_at
from ministries m
join leader_ministries lm on lm.ministry_id = m.id
where m.campus_id is not null
on conflict do nothing;

insert into user_ministry_memberships(user_id, ministry_id)
select lead_user_id, ministry_id
from ministry_campus_leads
on conflict do nothing;

drop index if exists leader_ministries_ministry_idx;
create index if not exists leader_ministries_ministry_idx on leader_ministries(ministry_id);
create index if not exists user_ministry_memberships_ministry_idx
  on user_ministry_memberships(ministry_id, user_id);
create index if not exists ministry_campus_leads_campus_idx
  on ministry_campus_leads(campus_id, lead_user_id);

alter table ministries
  drop constraint if exists ministries_campus_id_name_key;

alter table ministries
  drop column if exists campus_id;

comment on table user_ministry_memberships is 'User profile ministry memberships selected from the profile screen.';
comment on table leader_ministries is 'One Ministry Head assignment per ministry.';
comment on table ministry_campus_leads is 'Campus-specific lead assignment for each global ministry.';

commit;
