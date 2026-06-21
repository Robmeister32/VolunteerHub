# VolunteerHub Module Documentation

**Document version:** 1.0  
**Implementation reviewed:** June 15, 2026  
**Primary sources:** Express API, React clients, PostgreSQL migrations, database views, and backend tests

## 1. Purpose and Scope

VolunteerHub is a church volunteer-operations platform with:

- An installable React mobile/PWA client for volunteers, team leaders, event leaders, and administrators.
- A separate React planning web application for operational reporting and staffing visibility.
- A shared Express 5 API that authenticates Firebase users and enforces application permissions.
- A private PostgreSQL/Supabase schema that stores authorization, volunteer, scheduling, communication, task, compliance, reporting, and audit data.

This document describes the application's implemented business modules. For each module it explains what the module does, its functional specifications, and the business rules enforced by the current code and database.

### Implementation labels

- **Implemented:** The primary workflow is exposed through the API and a client.
- **Foundation:** The data model or reporting logic exists, but administration or provider workflows are not fully exposed.
- **Planning UI:** The interface communicates intended planning behavior, but some displayed signals are currently static.

## 2. System Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Mobile/PWA | React 19, Vite, Firebase client SDK | Daily volunteer and operational workflows |
| Planning web app | React 19, Vite, Firebase client SDK | Planning and executive reporting workspace |
| Shared API | Node.js, Express 5, Zod, Firebase Admin | Authentication, authorization, validation, business rules, and database orchestration |
| Data platform | PostgreSQL/Supabase | Private domain data, constraints, triggers, derived reporting views, and audit history |
| External boundaries | Firebase, Google Geocoding, future messaging/storage providers | Identity, geocoding, and provider integrations |

### Shared platform rules

- Clients authenticate directly with Firebase and send a Firebase ID token to the API.
- The API accepts domain access only when the Firebase identity maps to an `ACTIVE` `app_users` record.
- The `volunteerhub` PostgreSQL schema is private and is not intended for direct client access.
- Request payloads are validated with Zod before business logic runs.
- Multi-record operations use database transactions where partial completion would create inconsistent state.
- Database foreign keys, checks, triggers, and unique indexes provide a second enforcement layer.
- Sensitive and administrative actions write records to `audit_logs`.
- External delivery work is queued in `outbox_jobs`; provider workers are integration boundaries outside the current API.

## 3. Roles and Authorization Model

VolunteerHub uses an extensible role catalog. The seeded roles are:

| Role | Intended responsibility |
|---|---|
| `ADMIN` | Church-wide administration, configuration, applications, exports, and unrestricted operational access |
| `EVENT_LEADER` | Event and team operations, roster decisions, attendance, communications, and scoped task management |
| `TEAM_LEADER` | May be assigned as an Event Team leader; supported by the role catalog and leader validation |
| `VOLUNTEER` | Profile, household, signup, commitments, tasks, check-in, and communication access |

Important implementation detail: API TypeScript types explicitly list `ADMIN`, `EVENT_LEADER`, and `VOLUNTEER`, while the database and event-team leader validation also support `TEAM_LEADER`. The role catalog is extensible, but API guards must be updated before a new role can receive route-level permissions.

## 4. Module Summary

| Module | Status | Primary users |
|---|---|---|
| Identity and Access | Implemented | All users, administrators |
| Volunteer Applications, Profiles, and Preferences | Implemented | Volunteers, administrators |
| Households and Managed Dependents | Implemented | Volunteers/guardians, administrators |
| Organization and Catalog Administration | Implemented | Administrators |
| Compliance and Role Readiness | Foundation | Administrators, planners |
| Events and Event Teams | Implemented | Administrators, leaders, volunteers |
| Signup, Assignments, and Rosters | Implemented | Volunteers, guardians, leaders, administrators |
| Attendance and Location-Bound Check-In | Implemented | Volunteers, leaders, administrators |
| Operational Tasks | Implemented | Team members, leaders, administrators |
| Broadcast Communications | Implemented with provider boundary | Leaders, administrators |
| Direct Conversations and SMS Relay | Implemented with provider boundary | Volunteers and leaders |
| Dashboards, Reporting, Exports, and Audit | Implemented | Leaders and administrators |
| Planning Web Workspace | Planning UI | Leaders and administrators |
| Platform Services and Integrations | Implemented with integration boundaries | Operators and developers |

## 5. Identity and Access Module

### What it does

Connects Firebase identities to VolunteerHub domain users, loads assigned system roles and ministry scope, and protects API operations.

### Functional specifications

- Public registration creates a Firebase account in the client and a VolunteerHub profile through `POST /api/auth/register`.
- Existing identities sign in through Firebase Email/Password authentication.
- `GET /api/me` returns the domain profile, roles, volunteer ID, ministry assignments, preferences, and household.
- Administrators can create and update role definitions and replace a user's complete role assignment set.
- A command-line provisioning workflow creates or activates the first administrator.

### Core data

`app_users`, `roles`, `app_user_roles`, `leader_ministries`

### Business rules

- A valid Firebase token is required for all protected endpoints.
- A Firebase identity without an active VolunteerHub domain user receives a `403` response.
- User status must be `ACTIVE` for domain access.
- Public registration cannot create a second VolunteerHub profile for the same Firebase UID.
- Every user role assignment update must contain at least one role.
- Assigned role codes must exist and be active.
- System role codes must start with an uppercase letter and contain only uppercase letters, digits, and underscores.
- Event leaders must be active users with `ADMIN` or `EVENT_LEADER`.
- Event Team leaders must be active users with `ADMIN`, `EVENT_LEADER`, or `TEAM_LEADER`.
- Role assignment changes and role catalog changes are audited.

### Boundaries and notes

- Firebase owns passwords, email verification, password recovery, MFA, token issuance, and token revocation.
- The legacy `app_users.global_role` column remains in the base schema, but current authorization is loaded from `app_user_roles`.
- Route guards currently recognize a fixed TypeScript role union even though the database role catalog is extensible.

## 6. Volunteer Applications, Profiles, and Preferences Module

### What it does

Manages volunteer onboarding, application decisions, personal details, emergency contacts, profile-photo paths, notification preferences, and the administrator volunteer directory.

### Functional specifications

- Registration collects first name, optional middle name, last name, phone, birth date, and SMS consent.
- New registrations receive the `VOLUNTEER` role and a `SUBMITTED` volunteer application.
- Volunteers can update their own profile and communication preferences.
- Administrators can list submitted and rejected applications and approve or reject an application.
- Administrators and event leaders can view the volunteer directory.

### Primary API surface

`POST /api/auth/register`, `GET/PATCH /api/me`, `GET/PATCH /api/applications`, `GET /api/volunteers`

### Core data

`volunteer_profiles`, `notification_preferences`, `consents`, `volunteer_directory`

### Business rules

- First and last names are required; middle name is optional.
- Birth date is required during public registration.
- New applications start in `SUBMITTED`.
- Application decisions are limited to `APPROVED` or `REJECTED`.
- Decision time, deciding administrator, reason, and audit event are recorded.
- A person must be active and have an `APPROVED` application before signup.
- SMS defaults to disabled; email and push default to enabled.
- Granting SMS consent during registration creates a versioned `SMS` consent record.
- Profile changes update the linked user display name when name fields change.
- Profile photo storage uses a stored object path rather than a public URL.

### Boundaries and notes

- The database supports `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED`, and `WITHDRAWN`; the current UI/API decision workflow exposes submitted/rejected review and approve/reject actions.
- File upload and signed-URL generation are integration boundaries and are not implemented in the current routes.

## 7. Households and Managed Dependents Module

### What it does

Allows a volunteer to create a household implicitly, add managed dependents, provide participation consent, and schedule authorized dependents.

### Functional specifications

- A volunteer can add a dependent with name, birth date, relationship, and required participation consent.
- If the guardian has no household, the system creates one and adds the guardian as `Self`.
- A dependent receives a volunteer profile without an application user account.
- The guardian receives an active authorization for the dependent.
- Household members appear in the authenticated user's profile response.

### Primary API surface

`GET /api/me`, `POST /api/household/dependents`, `POST /api/event-groups/:eventGroupId/signup`

### Core data

`households`, `household_members`, `guardian_authorizations`, `consents`, `volunteer_profiles`

### Business rules

- Only users with a volunteer profile can add dependents.
- Dependent birth dates cannot be in the future.
- Dependent participation consent must explicitly be `true`.
- A dependent cannot be their own guardian.
- A volunteer profile can belong to only one household.
- Newly created dependents start with a `SUBMITTED` application.
- Guardian authorization starts as `ACTIVE`.
- A non-leader may schedule another volunteer only when an active guardian authorization links them.
- Administrators and event leaders may schedule a volunteer as a leader action.
- A dependent still must be active and approved before serving.

### Boundaries and notes

- Authorization revocation and household maintenance beyond dependent creation are represented in the schema but are not exposed through current API routes.

## 8. Organization and Catalog Administration Module

### What it does

Maintains campuses, ministries, ministry roles, and the active catalog used by event and volunteer workflows.

### Functional specifications

- Administrators can create, edit, activate, and deactivate campuses, ministries, and ministry roles.
- Authenticated users can read the active catalog.
- Campus coordinates may be supplied or resolved from the address through Google Geocoding.
- Ministry roles define age boundaries and whether administrative approval is required.

### Primary API surface

`GET /api/catalog`; administrator campus, ministry, and role endpoints under `/api/administration`

### Core data

`campuses`, `ministries`, `ministry_roles`, `leader_ministries`

### Business rules

- Campus names are unique.
- Ministry names are unique within a campus.
- Ministry role names are unique within a ministry.
- Latitude must be between -90 and 90; longitude must be between -180 and 180.
- If coordinates are not supplied, the backend attempts to geocode the full campus address.
- Geocoding failures distinguish unavailable service, no results, and invalid configuration.
- Country codes must be two characters and are normalized to uppercase.
- Minimum and maximum ages must be between 0 and 120.
- Maximum age, when provided, cannot be below minimum age.
- Only active campuses, ministries, and roles appear in the general catalog.
- Organization changes are administrator-only and audited.

### Boundaries and notes

- Ministry-to-leader assignments exist in the data model and are used for broadcast scope, but a maintenance API for `leader_ministries` is not currently exposed.

## 9. Compliance and Role Readiness Module

### What it does

Models training, background checks, documents, age rules, administrative approvals, explicit eligibility decisions, expiration, and derived volunteer readiness.

### Functional specifications

- Requirement definitions can represent background checks, training, documents, age rules, or administrative approval.
- Requirements can be assigned to ministry roles.
- Volunteer requirement records track completion, review, expiration, provider references, and private storage paths.
- Explicit role eligibility can mark a volunteer pending, eligible, ineligible, suspended, or expired.
- Reporting views calculate effective requirement status, readiness, and expiring requirements.
- The domain helper returns eligibility plus human-readable reasons.

### Core data and views

`requirement_definitions`, `role_requirements`, `volunteer_requirement_records`, `volunteer_role_eligibility`, `volunteer_requirement_status`, `volunteer_role_readiness`, `expiring_requirements`

### Business rules

- Validity days, when configured, must be greater than zero.
- Storage bucket and storage path must either both be present or both be absent.
- Only one current requirement record may exist per volunteer and requirement for current statuses.
- Readiness requires an approved volunteer application.
- Readiness requires all mandatory requirement records to be complete, waived, or otherwise effective according to the reporting view.
- Expired requirements and explicit ineligible/suspended/expired decisions block readiness.
- Ministry role age limits contribute to readiness.

### Boundaries and notes

- The schema and derived views are implemented, but current API routes do not expose requirement-definition maintenance, record review, document upload, or eligibility decision workflows.
- Current Event Team signup validates approved/active volunteer status but does not call the role-readiness helper because Event Teams are no longer linked to ministry roles.

## 10. Events and Event Teams Module

### What it does

Creates scheduled events and the Event Teams within them, assigns leaders, defines staffing targets and signup/check-in policies, and manages event lifecycle.

### Functional specifications

- Administrators create and edit events.
- New events always begin as `DRAFT`.
- Events contain one or more Event Teams.
- Each Event Team has leaders, staffing target, signup policy, movement policy, self-check-in setting, instructions, and active state.
- Leaders and administrators can view active and draft upcoming events; volunteers see active upcoming events.
- Archived administration lists non-active/non-draft events from the previous 18 months.

### Primary API surface

`GET/POST/PATCH /api/events`, `POST /api/events/:eventId/groups`, `PATCH /api/event-groups/:eventGroupId`, archived-event and status endpoints

### Core data and views

`events`, `event_groups`, `event_group_staffing`, `event_staffing_summary`

### Business rules

- Event statuses are `DRAFT`, `ACTIVE`, `COMPLETE`, `CANCELLED`, and `REMOVED`.
- Event end time must be after start time.
- Events belong to a campus.
- Event leader IDs must reference active administrators or event leaders.
- Event Team leader IDs must reference active administrators, event leaders, or team leaders.
- Event Team names are unique within an event.
- Required volunteer count cannot be negative.
- Signup and movement policy values are `AUTO` or `APPROVAL`.
- Check-in minutes before and after cannot be negative.
- Check-in radius must be greater than zero.
- Only active Event Teams under active events accept signup or new task creation.
- Creation and updates are audited.

### Boundaries and notes

- Event creation/editing and Event Team maintenance are administrator-only in the current API. Leaders manage operational work after setup.
- Event signup, cancellation, and change deadline fields exist, but current event create/edit payloads expose neither deadline maintenance nor Event Team check-in window/radius maintenance.
- Movement policy and assignment change-request tables exist, but move/swap workflows are not exposed by the current API.

## 11. Signup, Assignments, and Rosters Module

### What it does

Allows approved volunteers and authorized dependents to join Event Teams, routes signups through automatic or approval-based staffing, and gives leaders scoped roster decision access.

### Functional specifications

- Volunteers can sign themselves up.
- Guardians can sign up authorized dependents.
- Administrators and event leaders can sign up another volunteer.
- Automatic signup confirms an assignment while space remains and waitlists it when the team is full.
- Approval signup creates a requested assignment.
- Leaders can confirm or reject requested assignments within their event scope.
- Users can cancel assignments according to ownership and role.
- Event rosters show assignment and attendance state.

### Primary API surface

`POST /api/event-groups/:eventGroupId/signup`, `GET /api/events/:eventId/roster`, `PATCH /api/assignments/:id/decision`, `POST /api/assignments/:id/cancel`, `GET /api/my-commitments`

### Core data and views

`assignments`, `assignment_change_requests`, `event_roster`, `event_group_staffing`

### Business rules

- Signup requires an active, approved volunteer.
- Signup is allowed only for an active Event Team under an active event.
- Signup is rejected after the event signup deadline when one is set.
- A volunteer may have only one active assignment per Event Team across `REQUESTED`, `WAITLISTED`, and `CONFIRMED`.
- Assignment source records whether the action came from a volunteer, guardian, leader, administrator, move, or swap.
- Approval decisions are limited to `CONFIRMED` or `REJECTED`.
- A leader can decide an assignment only when assigned to the Event Team or parent event; administrators are unrestricted.
- A requested assignment cannot be confirmed after the Event Team is fully staffed.
- A standard volunteer can cancel only their own assignment.
- Cancellation records the cancellation time and an audit event.
- Every new assignment automatically receives an attendance record.

### Boundaries and notes

- Cancellation deadlines and movement/change deadlines are not currently enforced by the cancellation endpoint.
- Auto-promotion from waitlist after a cancellation is not implemented.
- The schema supports move and swap requests, but no route currently creates or decides them.

## 12. Attendance and Location-Bound Check-In Module

### What it does

Records attendance states and supports time- and location-restricted volunteer self-check-in.

### Functional specifications

- Volunteers can check themselves in from the mobile/PWA client.
- Leaders and administrators can record attendance for roster members.
- Attendance states are `NOT_RECORDED`, `CHECKED_IN`, `PRESENT`, `ABSENT`, and `EXCUSED`.
- Self-check-in can require device location and compares it with event coordinates.

### Primary API surface

`POST /api/assignments/:id/checkin`

### Core data

`attendance`, `assignments`, `event_groups`, `events`

### Business rules

- A standard volunteer can record attendance only for their own assignment.
- A non-admin event leader must be assigned to the Event Team or parent event.
- Volunteer self-check-in must occur inside the configured window around event start.
- Default Event Team check-in window is 30 minutes before through 30 minutes after event start.
- When self-check-in is enabled, latitude and longitude are required.
- Check-in must be within the Event Team's configured radius; the default is 300 meters.
- Latitude and longitude are stored together or not at all.
- Attendance updates record who performed the action and write an audit event.

### Boundaries and notes

- Leader/admin attendance actions bypass volunteer time and location restrictions.
- The current route updates the pre-created attendance record; it does not change assignment status to `COMPLETED` or `NO_SHOW`.

## 13. Operational Tasks Module

### What it does

Lets leaders create short operational requests for confirmed Event Team members, supports multi-volunteer claiming, and tracks work from open through completion.

### Functional specifications

- Administrators and event leaders create tasks for an active Event Team.
- Task recipients are snapshotted from the team's confirmed assignments when the task is created or moved to another team.
- Recipients can claim and withdraw from tasks.
- Claimants, scoped leaders, and administrators can start or complete tasks.
- Administrators can edit tasks while they are open or staffed.
- The mobile/PWA displays active tasks and a navigation badge.

### Primary API surface

Task endpoints under `/api/tasks`, `/api/my-tasks`, and `/api/administration/tasks`

### Core data

`tasks`, `task_recipients`, `task_claims`

### Business rules

- Tasks must belong to an active Event Team under an active event.
- The database guarantees that the task's Event Team belongs to the selected event.
- Task title length is 2-160 characters; description is at most 4,000; location is at most 300.
- Required volunteer count is 1-50.
- Priority is `LOW`, `NORMAL`, `HIGH`, or `URGENT`.
- Lifecycle is `OPEN` -> `STAFFED` -> `IN_PROGRESS` -> `COMPLETED`; `CANCELLED` is also supported by the schema.
- Only a snapshotted recipient can claim a task.
- A volunteer cannot maintain two active claims for the same task.
- A claim is rejected when the task is not open or already has enough volunteers.
- Reaching the required claim count changes the task to `STAFFED`.
- Withdrawal is allowed only before work starts and returns the task to `OPEN`.
- A task can start only when fully staffed.
- A task can complete only when in progress.
- Claim, withdrawal, start, completion, creation, and update actions are audited.
- Task creation and claims enqueue outbox jobs for downstream notification processing.

### Boundaries and notes

- Task cancellation is supported in the database status model but is not exposed by a current route.
- Recipient snapshots do not automatically change when Event Team assignments change after task creation.

## 14. Broadcast Communications Module

### What it does

Queues multi-channel announcements targeted by ministry, event, and audience metadata.

### Functional specifications

- Administrators and event leaders can create broadcasts.
- Supported channels are push, email, and SMS.
- Broadcast records include subject, message, selected channels, optional ministry/event target, and an audience filter.
- Broadcast history is visible to administrators and leaders within permitted scope.
- Delivery work is queued through the outbox.

### Primary API surface

`POST /api/broadcasts`, `GET /api/broadcasts`

### Core data

`broadcasts`, `broadcast_deliveries`, `notification_preferences`, `consents`, `outbox_jobs`

### Business rules

- At least one supported channel is required.
- Event leaders who are not administrators must select a ministry assigned to them.
- Administrators can broadcast without a ministry restriction.
- New broadcasts enter `QUEUED`.
- A unique delivery row is allowed per broadcast, recipient, and channel.
- Delivery states support queued, sent, delivered, failed, skipped, and unsubscribed outcomes.
- Broadcast creation writes an audit event and a `BROADCAST_CREATED` outbox job.

### Boundaries and notes

- Audience expansion, consent filtering, delivery-row creation, provider calls, retries, and webhooks are expected downstream worker responsibilities and are not implemented in this API.
- Device registration is modeled but has no current registration endpoint.

## 15. Direct Conversations and SMS Relay Module

### What it does

Provides event-specific volunteer-to-leader conversations, unread counts, message history, and queued SMS relay delivery.

### Functional specifications

- A volunteer can start a conversation for an Event Team.
- The system selects the first Event Team leader, falling back to the first event leader.
- Leaders and volunteers can list only conversations in which they participate.
- Opening a conversation marks it read for the current user.
- Messages are queued as SMS relay messages.
- The mobile/PWA displays unread message counts.

### Primary API surface

`GET/POST /api/conversations`, `GET/POST /api/conversations/:id/messages`

### Core data

`conversations`, `messages`, `conversation_read_states`, `outbox_jobs`

### Business rules

- A new conversation requires an Event Team with at least one assigned team or event leader.
- A conversation is unique per event, volunteer, and leader.
- Starting an existing conversation reopens it.
- Only the assigned leader or participating volunteer can access its messages.
- Message bodies must contain 1-1,600 trimmed characters.
- New messages use the `SMS` channel and `QUEUED` delivery status.
- Reading messages upserts the user's last-read timestamp.
- Sending a message reopens the conversation, updates its activity time, writes an audit event, and queues an `SMS_RELAY_MESSAGE` job.

### Boundaries and notes

- SMS provider delivery, inbound SMS handling, provider status updates, and conversation reassignment are external/incomplete workflows.

## 16. Dashboards, Reporting, Exports, and Audit Module

### What it does

Provides role-aware operational metrics, staffing/compliance reports, service history, audit visibility, and administrator CSV exports.

### Functional specifications

- The operational dashboard shows upcoming events, pending assignments, pending applications, and expiring compliance.
- Event leaders receive metrics limited to their event leadership scope for upcoming events and pending assignments.
- The reporting endpoint returns staffing, attendance, compliance, and the 25 most recent audit records.
- Administrators can export volunteers, events, and assignments as CSV.
- Derived views supply reusable reporting projections.

### Primary API surface

`GET /api/dashboard`, `GET /api/reports/overview`, `GET /api/exports/:type.csv`

### Core views and data

`dashboard_metrics`, `event_staffing_summary`, `event_group_staffing`, `event_roster`, `volunteer_service_history`, `volunteer_directory`, `audit_logs`

### Business rules

- Reports are available to administrators and event leaders.
- CSV exports are administrator-only.
- Supported export types are `volunteers`, `events`, and `assignments`.
- CSV values are quoted and embedded quotes are escaped.
- Administrator-only dashboard metrics, such as pending applications and expiring compliance, are hidden from non-admin leaders.
- Audit logs preserve actor, action, entity, details, and occurrence time.
- Audit entity references are intentionally polymorphic and do not use foreign keys.

### Boundaries and notes

- Report queries are broad for event leaders; unlike dashboard metrics, the overview report is not currently filtered to leader scope.
- The audit requirement is implemented for many sensitive routes, but there is no database-level guarantee that every future sensitive action writes an audit event.

## 17. Planning Web Workspace Module

### What it does

Provides a separate desktop-oriented planning and operational-intelligence experience for administrators and leaders.

### Functional specifications

- Firebase-authenticated users can open the planning workspace.
- The workspace loads `/api/reports/overview`.
- It calculates upcoming coverage and open positions from live staffing report data.
- It presents navigation concepts for executive overview, service planning, forecasting, volunteer capacity, requirements, and reports.

### Business rules

- Authentication is required before report data loads.
- Coverage is calculated as filled positions divided by required positions.
- Open positions are calculated as required minus filled.

### Boundaries and notes

- **Planning UI:** Only the executive overview currently consumes live API data.
- Forecast confidence, volunteer capacity, planning signals, ministry readiness examples, scenario creation, search, and non-overview navigation are currently static or non-functional presentation elements.

## 18. Platform Services and Integrations Module

### What it does

Provides shared database access, transactions, health checks, geocoding, asynchronous job records, and deployment integration boundaries.

### Functional specifications

- `/api/health` reports API identity, PostgreSQL reachability, and Firebase authentication.
- The PostgreSQL pool uses the `volunteerhub,public` search path.
- Remote database connections use TLS with certificate verification disabled by current configuration.
- Google Geocoding resolves campus coordinates when coordinates are omitted.
- Transactions wrap dependent, role assignment, task, and other multi-write workflows.
- Outbox jobs persist provider work for later processing.

### Business rules

- `POSTGRES_DSN` or `DATABASE_URL` is required.
- Google geocoding has a 10-second request timeout.
- Missing geocoding configuration returns service-unavailable when coordinates are needed.
- Database uniqueness conflicts are returned as HTTP `409`.
- Zod validation errors are returned as HTTP `400` with issue details.
- Unexpected server errors return HTTP `500` without exposing internal details.
- Updated-at triggers maintain timestamps across mutable domain tables.
- The private schema revokes access from public, anonymous, and authenticated Supabase client roles.

### Boundaries and notes

- Push, email, SMS, file storage, background-check providers, provider webhooks, durable workers, backups, and administrator MFA are deployment/integration responsibilities outside the current implementation.
- The repository contains local SQLite files under `backend/`, but the running backend implementation requires PostgreSQL.

## 19. Key Status Lifecycles

### Volunteer application

`DRAFT` -> `SUBMITTED` -> `APPROVED` or `REJECTED`; `WITHDRAWN` is supported by the database.

### Event

`DRAFT` -> `ACTIVE` -> `COMPLETE`, `CANCELLED`, or `REMOVED`.

### Assignment

Signup creates `REQUESTED`, `WAITLISTED`, or `CONFIRMED`. Later states include `REJECTED`, `CANCELLED`, `COMPLETED`, and `NO_SHOW`.

### Attendance

`NOT_RECORDED` -> `CHECKED_IN`, `PRESENT`, `ABSENT`, or `EXCUSED`.

### Operational task

`OPEN` -> `STAFFED` -> `IN_PROGRESS` -> `COMPLETED`; `CANCELLED` is supported by the database.

### Broadcast

`DRAFT` -> `QUEUED` -> `SENDING` -> `COMPLETE`; failure and cancellation states are supported.

### Outbox job

`PENDING` -> `PROCESSING` -> `COMPLETE`; failure and cancellation states are supported.

## 20. Known Cross-Module Gaps and Risks

These items are important when treating this document as a product specification:

1. Compliance/readiness is modeled and reported, but management APIs and UI are not implemented.
2. Event Team signup does not currently evaluate ministry-role readiness.
3. Assignment cancellation does not enforce configured cancellation deadlines.
4. Move/swap/change-request workflows and movement policies are modeled but not exposed.
5. Waitlisted volunteers are not automatically promoted when capacity opens.
6. Broadcast and SMS relay provider workers are not included.
7. The planning web application's non-overview sections and several displayed metrics are static.
8. `TEAM_LEADER` exists in the database catalog but is not included in the API's `UserRole` TypeScript union.
9. The overview reporting endpoint is not filtered to an event leader's scope.
10. Private document/photo storage paths are modeled, but upload and signed-download routes are not implemented.

## 21. Verification Baseline

The backend test suite verifies:

- PostgreSQL connectivity.
- Installation of 33 base tables and 9 views.
- Location-distance calculation used by check-in.
- Operational-task recipient and claim tables.
- Task list ordering and editable-task support.
- Active-task visibility rules.
- Conversation unread-state support.
- Optional middle names across user, volunteer, and household records.
- Current event lifecycle values and the `DRAFT` default.
- Campus address formatting for geocoding.

Recommended regression coverage additions include route-level authorization tests, signup capacity race tests, check-in boundary tests, task lifecycle tests, broadcast scope tests, and conversation access tests.
