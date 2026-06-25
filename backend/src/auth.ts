import type { NextFunction, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { all, get } from "./db.js";
import { initializeFirebaseAdmin } from "./firebase-admin.js";
import type { AuthedRequest, AuthUser, UserRole } from "./types.js";

const firebaseAuth = getAuth(initializeFirebaseAdmin());

export async function domainUser(firebaseUid: string): Promise<AuthUser | undefined> {
  const user = await get<{ id: string; auth_uid: string; email: string; roles: UserRole[]; volunteer_id?: string }>(
    `select u.id, u.auth_uid, u.email,
       coalesce(array_agg(aur.role_code) filter (where aur.role_code is not null), '{}') roles,
       v.id volunteer_id
     from volunteerhub.app_users u left join volunteerhub.volunteer_profiles v on v.app_user_id=u.id
     left join volunteerhub.app_user_roles aur on aur.user_id=u.id
     where u.auth_uid=$1 and u.status='ACTIVE'
     group by u.id, v.id`,
    [firebaseUid]
  );
  if (!user) return undefined;
  const ministryIds = (
    await all<{ ministry_id: string }>("select ministry_id from volunteerhub.leader_ministries where user_id=$1", [
      user.id
    ])
  ).map((row) => row.ministry_id);
  return {
    id: user.id,
    authUid: user.auth_uid,
    email: user.email,
    roles: user.roles,
    volunteerId: user.volunteer_id,
    ministryIds
  };
}

export async function requireFirebase(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.firebase = await firebaseAuth.verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired Firebase token" });
  }
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  await requireFirebase(req, res, async () => {
    req.user = await domainUser(req.firebase!.uid);
    if (!req.user) return res.status(403).json({ error: "VolunteerHub access has not been provisioned" });
    next();
  });
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || (!req.user.roles.includes("ADMIN") && !roles.some((role) => req.user!.roles.includes(role))))
      return res.status(403).json({ error: "Insufficient permission" });
    next();
  };
}

export function hasRole(user: AuthUser, role: UserRole) {
  return user.roles.includes(role);
}
