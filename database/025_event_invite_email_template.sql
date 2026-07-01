begin;

set search_path = volunteerhub, public;

alter table email_templates alter column created_by drop not null;
comment on column email_templates.created_by is 'User who created the template. Null indicates a system-provided template.';

insert into email_templates(name, subject, body, created_by, is_active)
select
  'Event Volunteer Invitation - 5 Day Reminder',
  'Volunteer for {{event.name}}',
  'Hi {{volunteer.first_name}},

{{event.name}} is coming up on {{event.date}} at {{event.start_time}}, and we would love your help.

Please choose a team and volunteer here:
{{event.registration_url}}

Event: {{event.name}}
Campus: {{campus.name}}

Thank you,
{{leader.name}}',
  null,
  true
where not exists (
  select 1
  from email_templates
  where name = 'Event Volunteer Invitation - 5 Day Reminder'
);

commit;
