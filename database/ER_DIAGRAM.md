# VolunteerHub Entity Relationship Diagrams

These diagrams describe the base schema in `001_schema.sql`. The final section shows the Event Group scheduling
model implemented by `003_event_groups.sql`.

## Organization And Identity

```mermaid
erDiagram
    APP_USERS {
        uuid id PK
        text auth_uid UK
        text email UK
        text status
    }

    ROLES {
        text code PK
        text name UK
        text description
        boolean is_active
    }

    APP_USER_ROLES {
        uuid user_id PK,FK
        text role_code PK,FK
        uuid assigned_by FK
        timestamptz assigned_at
    }

    CAMPUSES {
        uuid id PK
        text name UK
        text city
        text region
        boolean is_active
    }

    MINISTRIES {
        uuid id PK
        uuid campus_id FK
        text name
        boolean is_active
    }

    MINISTRY_ROLES {
        uuid id PK
        uuid ministry_id FK
        text name
        smallint minimum_age
        smallint maximum_age
        boolean requires_admin_approval
        boolean is_active
    }

    LEADER_MINISTRIES {
        uuid user_id PK,FK
        uuid ministry_id PK,FK
        uuid assigned_by FK
        timestamptz assigned_at
    }

    CAMPUSES ||--o{ MINISTRIES : contains
    APP_USERS ||--o{ APP_USER_ROLES : has
    ROLES ||--o{ APP_USER_ROLES : assigned_as
    APP_USERS o|--o{ APP_USER_ROLES : assigns
    MINISTRIES ||--o{ MINISTRY_ROLES : defines
    APP_USERS ||--o{ LEADER_MINISTRIES : leads
    MINISTRIES ||--o{ LEADER_MINISTRIES : has_leaders
    APP_USERS o|--o{ LEADER_MINISTRIES : assigns
```

## Volunteers, Households, And Compliance

```mermaid
erDiagram
    APP_USERS {
        uuid id PK
        text auth_uid UK
    }

    VOLUNTEER_PROFILES {
        uuid id PK
        uuid app_user_id FK
        uuid application_decided_by FK
        text first_name
        text last_name
        text application_status
        boolean is_active
    }

    NOTIFICATION_PREFERENCES {
        uuid volunteer_id PK,FK
        boolean push_enabled
        boolean email_enabled
        boolean sms_enabled
    }

    HOUSEHOLDS {
        uuid id PK
        uuid created_by FK
        text name
    }

    HOUSEHOLD_MEMBERS {
        uuid household_id PK,FK
        uuid volunteer_id FK
        text relationship
        boolean is_guardian_managed
    }

    GUARDIAN_AUTHORIZATIONS {
        uuid guardian_volunteer_id PK,FK
        uuid dependent_volunteer_id PK,FK
        uuid authorized_by FK
        text status
    }

    CONSENTS {
        uuid id PK
        uuid volunteer_id FK
        uuid guardian_volunteer_id FK
        text consent_type
        boolean granted
    }

    MINISTRY_ROLES {
        uuid id PK
        uuid ministry_id FK
        text name
    }

    REQUIREMENT_DEFINITIONS {
        uuid id PK
        text name
        text requirement_type
        boolean is_active
    }

    ROLE_REQUIREMENTS {
        uuid role_id PK,FK
        uuid requirement_id PK,FK
        boolean is_required
    }

    VOLUNTEER_REQUIREMENT_RECORDS {
        uuid id PK
        uuid volunteer_id FK
        uuid requirement_id FK
        uuid reviewed_by FK
        text status
        timestamptz expires_at
    }

    VOLUNTEER_ROLE_ELIGIBILITY {
        uuid volunteer_id PK,FK
        uuid role_id PK,FK
        uuid decided_by FK
        text status
        timestamptz expires_at
    }

    APP_USERS o|--o| VOLUNTEER_PROFILES : owns_account
    APP_USERS o|--o{ VOLUNTEER_PROFILES : decides_application
    VOLUNTEER_PROFILES ||--o| NOTIFICATION_PREFERENCES : configures
    APP_USERS o|--o{ HOUSEHOLDS : creates
    HOUSEHOLDS ||--o{ HOUSEHOLD_MEMBERS : contains
    VOLUNTEER_PROFILES ||--o| HOUSEHOLD_MEMBERS : belongs_to
    VOLUNTEER_PROFILES ||--o{ GUARDIAN_AUTHORIZATIONS : guardian
    VOLUNTEER_PROFILES ||--o{ GUARDIAN_AUTHORIZATIONS : dependent
    APP_USERS o|--o{ GUARDIAN_AUTHORIZATIONS : authorizes
    VOLUNTEER_PROFILES ||--o{ CONSENTS : grants
    VOLUNTEER_PROFILES o|--o{ CONSENTS : guardian_grants
    MINISTRY_ROLES ||--o{ ROLE_REQUIREMENTS : requires
    REQUIREMENT_DEFINITIONS ||--o{ ROLE_REQUIREMENTS : assigned_to_role
    VOLUNTEER_PROFILES ||--o{ VOLUNTEER_REQUIREMENT_RECORDS : completes
    REQUIREMENT_DEFINITIONS ||--o{ VOLUNTEER_REQUIREMENT_RECORDS : recorded_as
    APP_USERS o|--o{ VOLUNTEER_REQUIREMENT_RECORDS : reviews
    VOLUNTEER_PROFILES ||--o{ VOLUNTEER_ROLE_ELIGIBILITY : receives
    MINISTRY_ROLES ||--o{ VOLUNTEER_ROLE_ELIGIBILITY : governs
    APP_USERS o|--o{ VOLUNTEER_ROLE_ELIGIBILITY : decides
```

## Current Event And Scheduling Model

> This is the current schema. It supports one ministry per event and will be replaced by the proposed Event Group
> model below.

```mermaid
erDiagram
    APP_USERS {
        uuid id PK
    }

    CAMPUSES {
        uuid id PK
        text name
    }

    MINISTRIES {
        uuid id PK
        uuid campus_id FK
        text name
    }

    MINISTRY_ROLES {
        uuid id PK
        uuid ministry_id FK
        text name
    }

    VOLUNTEER_PROFILES {
        uuid id PK
        uuid app_user_id FK
        text first_name
        text last_name
    }

    EVENT_SERIES {
        uuid id PK
        uuid campus_id FK
        uuid ministry_id FK
        uuid created_by FK
        text name
        text recurrence_rule
    }

    EVENTS {
        uuid id PK
        uuid series_id FK
        uuid campus_id FK
        uuid ministry_id FK
        uuid created_by FK
        text name
        timestamptz starts_at
        timestamptz ends_at
        text status
    }

    EVENT_LEADERS {
        uuid event_id PK,FK
        uuid leader_user_id PK,FK
        boolean is_primary
    }

    EVENT_REQUIREMENTS {
        uuid event_id PK,FK
        uuid role_id PK,FK
        integer required_count
        boolean waitlist_enabled
    }

    ASSIGNMENTS {
        uuid id PK
        uuid event_id FK
        uuid role_id FK
        uuid volunteer_id FK
        uuid requested_by FK
        uuid decided_by FK
        uuid previous_assignment_id FK
        text status
    }

    ASSIGNMENT_CHANGE_REQUESTS {
        uuid id PK
        uuid assignment_id FK
        uuid target_event_id FK
        uuid target_role_id FK
        uuid target_volunteer_id FK
        uuid requested_by FK
        uuid decided_by FK
        text request_type
        text status
    }

    ATTENDANCE {
        uuid assignment_id PK,FK
        uuid recorded_by FK
        text status
        timestamptz checkin_at
    }

    CAMPUSES ||--o{ EVENT_SERIES : hosts
    MINISTRIES ||--o{ EVENT_SERIES : schedules
    APP_USERS o|--o{ EVENT_SERIES : creates
    EVENT_SERIES o|--o{ EVENTS : generates
    CAMPUSES ||--o{ EVENTS : hosts
    MINISTRIES ||--o{ EVENTS : owns
    APP_USERS o|--o{ EVENTS : creates
    EVENTS ||--o{ EVENT_LEADERS : led_by
    APP_USERS ||--o{ EVENT_LEADERS : leads
    EVENTS ||--o{ EVENT_REQUIREMENTS : needs
    MINISTRY_ROLES ||--o{ EVENT_REQUIREMENTS : fills
    EVENT_REQUIREMENTS ||--o{ ASSIGNMENTS : receives
    VOLUNTEER_PROFILES ||--o{ ASSIGNMENTS : volunteers
    APP_USERS o|--o{ ASSIGNMENTS : requests
    APP_USERS o|--o{ ASSIGNMENTS : decides
    ASSIGNMENTS o|--o{ ASSIGNMENTS : replaces
    ASSIGNMENTS ||--o{ ASSIGNMENT_CHANGE_REQUESTS : changed_by
    EVENTS o|--o{ ASSIGNMENT_CHANGE_REQUESTS : target_event
    MINISTRY_ROLES o|--o{ ASSIGNMENT_CHANGE_REQUESTS : target_role
    VOLUNTEER_PROFILES o|--o{ ASSIGNMENT_CHANGE_REQUESTS : target_volunteer
    APP_USERS ||--o{ ASSIGNMENT_CHANGE_REQUESTS : requests
    APP_USERS o|--o{ ASSIGNMENT_CHANGE_REQUESTS : decides
    ASSIGNMENTS ||--|| ATTENDANCE : records
    APP_USERS o|--o{ ATTENDANCE : records
```

## Communications And Operations

```mermaid
erDiagram
    APP_USERS {
        uuid id PK
        text email
    }

    MINISTRIES {
        uuid id PK
        text name
    }

    EVENTS {
        uuid id PK
        text name
    }

    VOLUNTEER_PROFILES {
        uuid id PK
        uuid app_user_id FK
    }

    DEVICE_REGISTRATIONS {
        uuid id PK
        uuid user_id FK
        text platform
        text push_token UK
        boolean is_active
    }

    BROADCASTS {
        uuid id PK
        uuid sender_id FK
        uuid ministry_id FK
        uuid event_id FK
        text subject
        text status
    }

    BROADCAST_DELIVERIES {
        uuid id PK
        uuid broadcast_id FK
        uuid recipient_user_id FK
        text channel
        text status
    }

    CONVERSATIONS {
        uuid id PK
        uuid event_id FK
        uuid volunteer_id FK
        uuid leader_user_id FK
        text status
    }

    MESSAGES {
        uuid id PK
        uuid conversation_id FK
        uuid sender_user_id FK
        text channel
        text delivery_status
    }

    OUTBOX_JOBS {
        uuid id PK
        text job_type
        jsonb payload
        text status
    }

    AUDIT_LOGS {
        bigint id PK
        uuid actor_user_id FK
        text action
        text entity_type
        uuid entity_id
    }

    APP_USERS ||--o{ DEVICE_REGISTRATIONS : registers
    APP_USERS ||--o{ BROADCASTS : sends
    MINISTRIES o|--o{ BROADCASTS : targets
    EVENTS o|--o{ BROADCASTS : targets
    BROADCASTS ||--o{ BROADCAST_DELIVERIES : delivers
    APP_USERS ||--o{ BROADCAST_DELIVERIES : receives
    EVENTS ||--o{ CONVERSATIONS : concerns
    VOLUNTEER_PROFILES ||--o{ CONVERSATIONS : participates
    APP_USERS ||--o{ CONVERSATIONS : leads
    CONVERSATIONS ||--o{ MESSAGES : contains
    APP_USERS ||--o{ MESSAGES : sends
    APP_USERS o|--o{ AUDIT_LOGS : performs
```

`OUTBOX_JOBS` and `AUDIT_LOGS.entity_id` are intentionally polymorphic and therefore do not have foreign keys to
the records referenced by their payload or entity fields.

## Implemented Event Group Model

This replaces the legacy event scheduling model. Volunteers sign up directly for an `EVENT_GROUP`.

```mermaid
erDiagram
    APP_USERS {
        uuid id PK
    }

    CAMPUSES {
        uuid id PK
        text name
    }

    VOLUNTEER_PROFILES {
        uuid id PK
        text first_name
        text last_name
    }

    EVENTS {
        uuid id PK
        uuid campus_id FK
        uuid created_by FK
        text name
        timestamptz starts_at
        timestamptz ends_at
    }

    EVENT_GROUPS {
        uuid id PK
        uuid event_id FK
        text name
        uuid_array leader_user_ids
        integer required_volunteer_count
        boolean is_active
    }

    ASSIGNMENTS {
        uuid id PK
        uuid event_group_id FK
        uuid volunteer_id FK
        text status
    }

    CAMPUSES ||--o{ EVENTS : hosts
    APP_USERS o|--o{ EVENTS : creates
    EVENTS ||--o{ EVENT_GROUPS : contains
    EVENT_GROUPS ||--o{ ASSIGNMENTS : receives
    VOLUNTEER_PROFILES ||--o{ ASSIGNMENTS : volunteers
```

## Current Reporting Views

Views are derived projections rather than stored entities:

- `event_staffing_summary`
- `event_role_staffing`
- `event_roster`
- `volunteer_requirement_status`
- `volunteer_role_readiness`
- `expiring_requirements`
- `volunteer_service_history`
- `volunteer_directory`
- `dashboard_metrics`

The Event Group migration replaces `event_role_staffing` with `event_group_staffing` and adds group fields to event
roster and event staffing projections.
