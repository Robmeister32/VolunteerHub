# VolunteerHub

VolunteerHub is a production-oriented foundation for church volunteer operations. It includes an installable mobile PWA, a separate planning web application, a shared API, and a PostgreSQL/Supabase schema.

## Workspace Structure

```text
backend/   Shared API and business rules
mobile/    Installable volunteer and team-leader PWA
web/       Administration, planning, forecasting, and reporting
database/  PostgreSQL/Supabase migrations and views
docs/      Application module documentation
```

Detailed functional specifications and business rules are documented in
[`docs/MODULE_DOCUMENTATION.md`](docs/MODULE_DOCUMENTATION.md).

## Run locally

Requirements: Node.js 24 or newer.

```bash
npm install
npm run dev
```

- Mobile app: `http://localhost:5173`
- Web planning app: `http://localhost:5174`
- API: `http://localhost:4000/api`
- Authentication: Firebase accounts configured in your Firebase project

Run only one client with the API:

```bash
npm run dev:mobile
npm run dev:web
```

## Firebase And PostgreSQL

The clients authenticate directly with Firebase and send Firebase ID tokens to the shared API. The API verifies those tokens using Firebase Admin and loads authorization from Supabase/PostgreSQL.

After creating the first administrator in Firebase Authentication, provision that identity in VolunteerHub:

```bash
npm run provision:admin -w backend -- admin@example.org
```

Required root `.env` settings are documented in [`.env.example`](.env.example). Keep the Firebase service-account JSON outside source control.

Enable the **Email/Password** sign-in provider in Firebase Authentication before using the current sign-in and public-registration screens.

To automatically populate missing campus latitude and longitude values, enable the Google Maps **Geocoding API** and set `GOOGLE_MAPS_API_KEY` in the root `.env`. Restrict the key to the Geocoding API and the backend's deployment environment.

## Included workflows

- Public volunteer application and administrator decisions
- Role-based administrator, ministry leader, volunteer, and managed-dependent boundaries
- Campuses, ministries, roles, eligibility, training, background-check status, and documents
- Configurable event signup and movement policies
- Household volunteering, cancellation, rosters, approval/rejection, attendance, and location-bound check-in
- Push/email/SMS broadcast queue, SMS relay records, delivery-ready provider boundaries
- Independent web planning workspace with staffing forecasts and readiness signals
- Dashboards, staffing/compliance reports, audit logs, and authenticated CSV export

## Production deployment notes

The API now uses Firebase Authentication and PostgreSQL. Before production, deploy it behind TLS, configure backups, and connect approved push, email, SMS, file-storage, and background-check adapters. Administrator MFA, provider webhooks, and durable job processing should be configured as deployment services.

Useful environment variables:

```text
PORT=4000
POSTGRES_DSN=postgresql://...
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
GOOGLE_MAPS_API_KEY=...
VITE_API_URL=https://api.example.org/api
```

The production-ready PostgreSQL/Supabase structure and setup instructions are in [`database/README.md`](database/README.md).

## Verify

```bash
npm test
npm run build
npm audit
```
