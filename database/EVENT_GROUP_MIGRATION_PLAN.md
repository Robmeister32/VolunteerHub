# Event Group Migration

The simplified Event Group migration has been implemented in `003_event_groups.sql`.

## Implemented Model

```text
events
└── event_groups
    └── assignments
        └── attendance
```

- An event is the parent schedule item, such as Christmas Service.
- Event Teams are the teams volunteers choose, such as Choir, Greeters, or Security.
- Volunteers sign up directly for an Event Group.
- Each Event Group stores its leaders as `leader_user_ids uuid[]`.
- Each Event Group stores one `required_volunteer_count`.

## Database Changes Applied

- Added `events.event_leader_user_ids uuid[]`.
- Removed the obsolete `events.ministry_id` and `events.series_id` columns.
- Removed `event_series`, `event_leaders`, and `event_requirements`.
- Rebuilt `assignments` around `event_group_id`.
- Rebuilt assignment change requests and attendance.
- Added optional Event Group targeting to broadcasts and conversations.
- Rebuilt staffing, roster, service-history, volunteer-directory, and dashboard views.

## Event Group Table

The manually created `event_groups` table is retained:

```sql
event_groups (
  id uuid primary key,
  event_id uuid references events(id),
  name text,
  description text,
  instructions text,
  leader_user_ids uuid[],
  required_volunteer_count integer,
  signup_policy text,
  is_active boolean
)
```

## Important Application Rules

- The backend validates leader UUIDs before saving events or Event Teams.
- Automatic signups are confirmed until a group is full, then waitlisted.
- Approval-required signups remain requested until a leader or administrator decides them.
- Leaders can manage groups listed in `leader_user_ids`.
- Event leaders can manage every group under their event.
- A volunteer may have only one active assignment per Event Group.

## Fresh Database Setup

Run these files in order:

1. `001_schema.sql`
2. `002_views.sql`
3. `003_event_groups.sql`
4. `004_event_group_policies.sql`
5. `005_app_user_roles.sql`
6. `006_roles_catalog.sql`
7. `007_event_statuses.sql`

The later migrations transform the original scheduling model, move policies to Event Teams, and allow multiple
application roles per user through an extensible role catalog.
