-- Make administrators full participants as well as unrestricted operators.

begin;

set search_path = volunteerhub, public;

insert into app_user_roles(user_id, role_code, assigned_by)
select distinct aur.user_id, 'VOLUNTEER', aur.user_id
from app_user_roles aur
where aur.role_code = 'ADMIN'
on conflict do nothing;

with admins_without_profiles as (
  select
    u.id,
    coalesce(nullif(trim(u.display_name), ''), split_part(u.email, '@', 1)) as person_name
  from app_users u
  join app_user_roles aur on aur.user_id = u.id and aur.role_code = 'ADMIN'
  left join volunteer_profiles vp on vp.app_user_id = u.id
  where u.status = 'ACTIVE' and vp.id is null
)
insert into volunteer_profiles(
  app_user_id,
  first_name,
  last_name,
  application_status,
  application_submitted_at,
  application_decided_at,
  application_decided_by,
  is_active
)
select
  id,
  split_part(person_name, ' ', 1),
  case
    when position(' ' in person_name) > 0 then trim(substring(person_name from position(' ' in person_name) + 1))
    else 'Administrator'
  end,
  'APPROVED',
  now(),
  now(),
  id,
  true
from admins_without_profiles;

insert into notification_preferences(volunteer_id)
select vp.id
from volunteer_profiles vp
join app_user_roles aur on aur.user_id = vp.app_user_id and aur.role_code = 'ADMIN'
left join notification_preferences np on np.volunteer_id = vp.id
where np.volunteer_id is null
on conflict do nothing;

commit;
