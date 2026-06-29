import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { auth } from "./firebase";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.reasons?.join(". ") || body.error || "Request failed");
  return body as T;
}

export async function login(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password);
  await api("/auth/login", { method: "POST", body: JSON.stringify({}) });
  return api<Record<string, unknown>>("/me").then(toSession);
}

export async function registerApplication(payload: {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  phone?: string;
  birthDate: string;
  password: string;
  smsConsent: boolean;
}) {
  await api("/auth/register-application", { method: "POST", body: JSON.stringify(payload) });
}

export async function logout() {
  await signOut(auth);
}

export function observeAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

function toSession(me: Record<string, unknown>): Session {
  const roles = (me.roles as UserRole[]) ?? ["VOLUNTEER"];
  return {
    id: String(me.id),
    name: String(me.display_name || me.email || "Volunteer"),
    homeCampus: String(me.home_campus_name || "Campus not assigned"),
    homeCampusIds: (me.home_campus_ids as string[]) ?? [],
    roles,
    role: roles.includes("ADMIN")
      ? "ADMIN"
      : roles.includes("EVENT_LEADER")
        ? "EVENT_LEADER"
        : roles.includes("TEAM_LEADER")
          ? "TEAM_LEADER"
          : roles.includes("MINISTRY_HEAD")
            ? "MINISTRY_HEAD"
            : "VOLUNTEER",
    volunteerId: me.volunteer_id ? String(me.volunteer_id) : undefined,
    ministryIds: (me.ministry_ids as string[]) ?? []
  };
}

export async function currentSession() {
  return api<Record<string, unknown>>("/me").then(toSession);
}

export async function downloadExport(type: "volunteers" | "events" | "assignments") {
  const response = await fetch(`${API_URL}/exports/${type}.csv`, {
    headers: { Authorization: `Bearer ${(await auth.currentUser?.getIdToken()) ?? ""}` }
  });
  if (!response.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${type}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type UserRole = "ADMIN" | "EVENT_LEADER" | "TEAM_LEADER" | "MINISTRY_HEAD" | "VOLUNTEER";

export interface Session {
  id: string;
  name: string;
  homeCampus: string;
  homeCampusIds: string[];
  roles: UserRole[];
  role: UserRole;
  volunteerId?: string;
  ministryIds: string[];
}
export interface EventItem {
  id: string;
  campus_id: string;
  location_type?: "CAMPUS" | "OFF_SITE";
  participating_campus_ids?: string[];
  participating_campus_names?: string[];
  matches_home_campus?: boolean;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  address: string;
  latitude: number;
  longitude: number;
  campus_name: string;
  campus_address: string;
  status: EventStatus;
  event_leader_user_ids: string[];
  required_count: number;
  confirmed_count: number;
  groups: EventGroupItem[];
  my_assignments?: { id: string; status: string; event_group_id: string }[];
}
export type EventStatus = "ACTIVE" | "COMPLETE" | "DRAFT" | "CANCELLED" | "REMOVED";
export interface EventGroupItem {
  id: string;
  event_id: string;
  name: string;
  description: string;
  instructions: string;
  leader_user_ids: string[];
  signup_policy: "AUTO" | "APPROVAL";
  movement_policy: "AUTO" | "APPROVAL";
  self_checkin_enabled: boolean;
  required_count: number;
  confirmed_count: number;
  open_count: number;
  pending_count: number;
}
