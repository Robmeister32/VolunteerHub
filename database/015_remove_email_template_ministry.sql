begin;

set search_path = volunteerhub, public;

drop index if exists email_templates_ministry_idx;
alter table email_templates drop column if exists ministry_id;

commit;
