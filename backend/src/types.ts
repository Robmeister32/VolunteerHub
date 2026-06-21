import type { Request } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";

export type UserRole = "ADMIN" | "EVENT_LEADER" | "VOLUNTEER";

export interface AuthUser {
  id: string;
  authUid: string;
  email: string;
  roles: UserRole[];
  volunteerId?: string;
  ministryIds: string[];
}

export interface AuthedRequest extends Request {
  firebase?: DecodedIdToken;
  user?: AuthUser;
}
