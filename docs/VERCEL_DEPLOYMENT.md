# Vercel Frontend Deployment

VolunteerHub has two Vite frontends. Deploy them as two separate Vercel projects from the same Git repository.

## Projects

| Vercel project | Root directory | Build command | Output directory |
| --- | --- | --- | --- |
| VolunteerHub Admin | `web` | `npm run build` | `dist` |
| VolunteerHub Mobile PWA | `mobile` | `npm run build` | `dist` |

## Environment Variables

Set these variables on both Vercel projects for Production, Preview, and Development:

```text
VITE_API_URL=https://volunteerhub-api.fly.dev/api
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

After both projects have production URLs, update the Fly API CORS secret:

```powershell
fly secrets set "CORS_ORIGINS=https://YOUR_ADMIN_DOMAIN,https://YOUR_MOBILE_DOMAIN" --app volunteerhub-api
```

## Deploy With Git Integration

1. Push this repository to GitHub.
2. In Vercel, choose **Add New > Project**.
3. Import the repository.
4. Set **Root Directory** to `web`.
5. Confirm **Framework Preset** is Vite.
6. Add the environment variables above.
7. Deploy.
8. Repeat with a second Vercel project using **Root Directory** `mobile`.

## Deploy With Vercel CLI

From the repository root:

```powershell
npm install -g vercel
vercel login

vercel --cwd web
vercel --cwd web --prod

vercel --cwd mobile
vercel --cwd mobile --prod
```

During the first CLI deploy, Vercel will ask whether to link to an existing project or create a new one. Create one project for `web` and one project for `mobile`.
