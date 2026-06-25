-- Add searchable module metadata to audit logs. Existing audit entries used
-- entity_type as the functional area, so backfill module from entity_type.

begin;
set search_path = volunteerhub, public;

alter table audit_logs
  add column if not exists module text;

update audit_logs
set module = entity_type
where module is null;

alter table audit_logs
  alter column module set default 'system',
  alter column module set not null;

create index if not exists audit_logs_module_occurred_idx
  on audit_logs(module, occurred_at desc);

create index if not exists audit_logs_action_occurred_idx
  on audit_logs(action, occurred_at desc);

commit;
