# VolunteerHub PostgreSQL Schema

These migrations create the production data structure for Supabase Postgres while Firebase owns authentication.

Documentation:

- [`ER_DIAGRAM.md`](ER_DIAGRAM.md): current complete entity relationships and proposed Event Group model
- [`EVENT_GROUP_MIGRATION_PLAN.md`](EVENT_GROUP_MIGRATION_PLAN.md): Event Group redesign and safe migration order

## Run In Supabase

Run the files in order using the Supabase SQL Editor:

1. `001_schema.sql`
2. `002_views.sql`
3. `003_event_groups.sql`
4. `004_event_group_policies.sql`
5. `005_app_user_roles.sql`
6. `006_roles_catalog.sql`
7. `007_event_statuses.sql`
8. `008_conversation_read_states.sql`
9. `009_middle_names.sql`
10. `010_operational_tasks.sql`
11. `011_user_home_campus.sql`
12. `012_search_indexes.sql`
13. `013_admin_volunteer_access.sql`
14. `014_email_templates.sql`
15. `015_remove_email_template_ministry.sql`
16. `016_broadcast_audience.sql`

The migrations create a private `volunteerhub` schema. Do not add it to Supabase's **Exposed schemas** list. The FastAPI service should connect directly to Postgres using a dedicated database role and perform authorization after verifying Firebase ID tokens.

## Firebase Identity Mapping

After FastAPI verifies a Firebase ID token, locate the domain user with:

```sql
select *
from volunteerhub.app_users
where auth_uid = :firebase_uid
  and status = 'ACTIVE';
```

`app_users` intentionally has no password or session columns. Firebase owns passwords, email verification, account recovery, MFA, and token revocation.

Managed dependents have a `volunteer_profiles` row without an `app_user_id`. Adults with independent access have both an `app_users` row and a linked `volunteer_profiles` row.

## Storage Buckets

Create private Supabase Storage buckets separately:

- `profile-photos`
- `volunteer-documents`

Store object paths, not public URLs:

- `volunteer_profiles.profile_photo_path`
- `volunteer_requirement_records.storage_bucket`
- `volunteer_requirement_records.storage_path`

FastAPI should generate short-lived signed URLs only after checking the caller's authorization. Never expose background-check documents through a public bucket.

## Important Tables

- `app_users`, `roles`, `app_user_roles`: Firebase identities and assignable system roles
- `volunteer_profiles`, `households`, `guardian_authorizations`: people and families
- `ministries`, `ministry_roles`, `leader_ministries`: organizational authorization
- `requirement_definitions`, `role_requirements`, `volunteer_requirement_records`: compliance and training
- `events`, `event_groups`, `assignments`, `assignment_change_requests`, `attendance`: scheduling
- `broadcasts`, `broadcast_deliveries`, `conversations`, `messages`, `outbox_jobs`: communication and provider work
- `tasks`, `task_recipients`, `task_claims`: event-team operational requests and multi-volunteer claims
- `email_templates`: reusable email content with dynamic variables
- `audit_logs`: immutable application audit events

## Important Views

- `event_staffing_summary`
- `event_group_staffing`
- `event_roster`
- `volunteer_requirement_status`
- `volunteer_role_readiness`
- `expiring_requirements`
- `volunteer_service_history`
- `volunteer_directory`
- `dashboard_metrics`

## FastAPI Database Role

Create a dedicated login role using the Supabase database password manager or SQL editor. Replace the password before running:

```sql
create role volunteerhub_api login password 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
grant usage on schema volunteerhub to volunteerhub_api;
grant select, insert, update, delete on all tables in schema volunteerhub to volunteerhub_api;
grant usage, select on all sequences in schema volunteerhub to volunteerhub_api;
grant execute on all functions in schema volunteerhub to volunteerhub_api;

alter default privileges in schema volunteerhub
  grant select, insert, update, delete on tables to volunteerhub_api;
alter default privileges in schema volunteerhub
  grant usage, select on sequences to volunteerhub_api;
alter default privileges in schema volunteerhub
  grant execute on functions to volunteerhub_api;
```

Store its pooled Supabase connection string as a Fly.io secret named `DATABASE_URL`. Use the transaction pooler for normal API traffic and a direct connection for Alembic migrations.

## Application Rules

Some rules intentionally remain in FastAPI because they depend on current time, caller permissions, or external providers:

- Calculate eligibility from age, role requirements, unexpired records, and explicit suspension.
- Revalidate eligibility before creating or moving an assignment.
- Enforce signup, cancellation, and change deadlines.
- Enforce leader ministry boundaries.
- Validate self check-in time and distance.
- Resolve broadcast audiences and communication consent before creating delivery rows.
- Write an `audit_logs` record for every sensitive or administrative action.

The database additionally prevents active duplicate assignments, mismatched event roles, invalid status values, orphaned data, and multiple pending change requests.
