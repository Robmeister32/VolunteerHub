# VolunteerHub Role-Based Functionality

**Last updated:** June 24, 2026

This document summarizes role-based access in the current VolunteerHub API and mobile/PWA client.

## Role Summary

| Role | Primary scope |
|---|---|
| `ADMIN` | Church-wide operations, configuration, applications, reporting, exports, event setup, and unrestricted event communication. |
| `EVENT_LEADER` | Event-level operations for assigned events, including rosters, attendance, tasks, reports, and event broadcasts. |
| `TEAM_LEADER` | Event-team-level operations for teams they lead, including commitments, team chat, tasks by assignment, and team-scoped broadcasts. |
| `VOLUNTEER` | Personal profile, serving opportunities, commitments, check-in, messages, and assigned tasks. |

## Feature Matrix

| Feature area | `ADMIN` | `EVENT_LEADER` | `TEAM_LEADER` | `VOLUNTEER` |
|---|---|---|---|---|
| Sign in and view home dashboard | Yes | Yes | Yes | Yes |
| Submit volunteer application | Yes | Yes | Yes | Yes |
| Manage own profile, household, preferences | Yes | Yes | Yes | Yes |
| Browse active serving opportunities | Yes | Yes | Yes | Yes |
| Sign up, withdraw, and check in for own commitments | Yes | Yes | Yes | Yes |
| View own commitments | Yes | Yes | Yes | Yes |
| View event-team leader commitments for assigned teams | Team assignment based | Team assignment based | Team assignment based | Team assignment based |
| My Tasks | Yes | Yes | Yes | Yes |
| Claim, withdraw, start, and complete assigned tasks | Yes | Yes | Yes | Yes |
| Create operational tasks | Yes | Event/team scope | Event/team scope, when leading the selected team | No |
| Events and Teams workspace | Yes | Yes | No dedicated nav item | No dedicated nav item |
| Create and edit events | Yes | Create one-off draft events from Tools | No | No |
| Create draft events using an event template | Yes | Yes | No | No |
| Add and edit event teams | Yes | No | No | No |
| View rosters and update assignment status | Yes | Assigned event/team scope | Team scope when route permits team leadership | No |
| Review volunteer applications | Yes | No | No | No |
| Volunteer directory | Yes | Yes | No | No |
| Reports overview | Yes | Yes | No | No |
| CSV exports | Yes | No | No | No |
| Administration workspace | Yes | No | No | No |
| Campus, ministry, role, and user-role administration | Yes | No | No | No |
| Archived event status management | Yes | No | No | No |
| Audit log review | Yes | No | No | No |
| Direct conversations and SMS relay | Yes | Leader/member scope | Leader/member scope | Own conversation scope |
| Event-team group chat | Member/leader scope | Member/leader scope | Leader scope | Confirmed member scope |

## Tools Menu

The Tools menu is visible to every authenticated role. Individual tiles are role based:

| Tool | `ADMIN` | `EVENT_LEADER` | `TEAM_LEADER` | `VOLUNTEER` |
|---|---|---|---|---|
| Email Templates | Create, edit, and deactivate all templates | Create and edit own templates | Not shown | Not shown |
| Create Event | Create one-off draft events with campus or off-site locations, participating campus targeting, and initial event teams | Create one-off draft events with campus or off-site locations, participating campus targeting, and initial event teams | Not shown | Not shown |
| Event Templates | Create and edit reusable event/team templates | Create and edit own reusable event/team templates | Not shown | Not shown |
| Create Events Using Template | Generate draft event instances and teams from an event template | Generate draft event instances and teams from own event templates | Not shown | Not shown |
| Broadcasts | Event-level targeting for any event | Event-level targeting for assigned events | Event-team-level targeting for teams they lead | Not shown |

## Communication Rules

- Email template variables and template creation are limited to `ADMIN` and `EVENT_LEADER`.
- Event template creation is limited to `ADMIN` and `EVENT_LEADER`; event templates store reusable event details and preconfigured event teams for later scheduling.
- Event-template scheduling creates draft event instances and copies the template's Event Teams across the selected occurrence and interval.
- Active email templates may be used by roles that can create broadcasts.
- Broadcast creation is allowed for `ADMIN`, `EVENT_LEADER`, and `TEAM_LEADER`.
- `ADMIN` can broadcast at event level without an event-team restriction.
- `EVENT_LEADER` can broadcast at event level for assigned events.
- `TEAM_LEADER` can broadcast only to selected event teams they lead.
- Broadcast history is scoped to administrators, senders, assigned event leaders, and event-team leaders for matching events or teams.

## Notes

- Database constraints remain a second authorization layer for leader assignments and role validity.
- API route guards still use explicit role lists even though the database role catalog is extensible.
- Several workflows also enforce record-level scope after the role check, especially rosters, tasks, broadcasts, conversations, and group chat.
- Audit search is administrator-only and supports `module:{module wildcard}` filters, such as `module:event*`.
