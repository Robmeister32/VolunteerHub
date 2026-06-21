import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { pool } from "./db.js";

const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error("Usage: npm run provision:admin -w backend -- admin@example.org");

const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!configuredPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required");
const root = resolve(import.meta.dirname, "../..");
const path = isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);
const serviceAccount = JSON.parse(readFileSync(path, "utf8"));
if (!getApps().length) initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });

const firebaseUser = await getAuth().getUserByEmail(email);
await pool.query(
  `with provisioned as (
     insert into volunteerhub.app_users(auth_uid,email,display_name,status)
     values($1,$2,$3,'ACTIVE')
     on conflict(auth_uid) do update set status='ACTIVE',email=excluded.email,display_name=excluded.display_name
     returning id,email,display_name
   ), assigned_roles as (
     insert into volunteerhub.app_user_roles(user_id,role_code,assigned_by)
     select p.id,role_code,p.id
     from provisioned p cross join unnest(array['ADMIN','VOLUNTEER']::text[]) role_code
     on conflict do nothing
   ), volunteer as (
     insert into volunteerhub.volunteer_profiles(
       app_user_id,first_name,last_name,application_status,application_submitted_at,
       application_decided_at,application_decided_by,is_active
     )
     select p.id,
       split_part(coalesce(nullif(trim(p.display_name),''),split_part(p.email,'@',1)),' ',1),
       case
         when position(' ' in coalesce(nullif(trim(p.display_name),''),split_part(p.email,'@',1))) > 0
           then trim(substring(
             coalesce(nullif(trim(p.display_name),''),split_part(p.email,'@',1))
             from position(' ' in coalesce(nullif(trim(p.display_name),''),split_part(p.email,'@',1))) + 1
           ))
         else 'Administrator'
       end,
       'APPROVED',now(),now(),p.id,true
     from provisioned p
     on conflict(app_user_id) do update set
       application_status='APPROVED',application_decided_at=now(),
       application_decided_by=excluded.application_decided_by,is_active=true
     returning id
   )
   insert into volunteerhub.notification_preferences(volunteer_id)
   select id from volunteer
   on conflict do nothing`,
  [firebaseUser.uid, firebaseUser.email, firebaseUser.displayName ?? firebaseUser.email]
);
console.log(`Provisioned ${email} as a VolunteerHub administrator and volunteer.`);
await pool.end();
