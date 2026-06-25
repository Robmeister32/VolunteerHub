-- Allow users to have multiple home campuses while keeping app_users.home_campus_id
-- as the primary/default campus for compatibility.

begin;
set search_path = volunteerhub, public;

create table user_home_campuses (
  user_id uuid not null references app_users(id) on delete cascade,
  campus_id uuid not null references campuses(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, campus_id)
);

insert into user_home_campuses(user_id, campus_id, is_primary)
select id, home_campus_id, true
from app_users
where home_campus_id is not null
on conflict (user_id, campus_id) do nothing;

create index user_home_campuses_campus_idx on user_home_campuses(campus_id, user_id);
create unique index user_home_campuses_one_primary_idx
  on user_home_campuses(user_id)
  where is_primary;

commit;
