begin;

set search_path = volunteerhub, public;

alter table broadcasts
  add column email_template_id uuid references email_templates(id) on delete set null;

create index broadcasts_email_template_idx on broadcasts(email_template_id);

commit;
