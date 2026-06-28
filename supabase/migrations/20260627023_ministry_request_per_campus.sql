-- Allow one ministry membership request per ministry and campus.

begin;
set search_path = volunteerhub, public;

drop index if exists ministry_membership_requests_one_pending_idx;
drop index if exists ministry_membership_requests_one_per_ministry_idx;

create unique index if not exists ministry_membership_requests_one_per_ministry_campus_idx
  on ministry_membership_requests(user_id, ministry_id, campus_id);

commit;
