begin;

set search_path = volunteerhub, public;

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null,
  ministry_id uuid references ministries(id) on delete set null,
  created_by uuid not null references app_users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_templates_name_length check (char_length(trim(name)) between 2 and 120),
  constraint email_templates_subject_length check (char_length(trim(subject)) between 1 and 200),
  constraint email_templates_body_length check (char_length(body) between 1 and 20000)
);

create index email_templates_ministry_idx on email_templates(ministry_id);
create index email_templates_created_by_idx on email_templates(created_by);

create trigger email_templates_updated_at
before update on email_templates
for each row execute function set_updated_at();

commit;
