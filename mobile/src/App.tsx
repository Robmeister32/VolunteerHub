import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactNode
} from "react";
import {
  Archive,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  GripVertical,
  Home,
  LogOut,
  MapPin,
  Mail,
  Megaphone,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Wrench,
  X,
  Trash2
} from "lucide-react";
import {
  api,
  currentSession,
  downloadExport,
  login,
  logout,
  observeAuth,
  registerApplication,
  type EventGroupItem,
  type EventItem,
  type EventStatus,
  type Session,
  type UserRole
} from "./api";
import { useDebouncedValue } from "./useDebouncedValue";

const GroupChat = lazy(() => import("./GroupChat").then((module) => ({ default: module.GroupChat })));

type View =
  | "home"
  | "serve"
  | "commitments"
  | "tasks"
  | "messages"
  | "events"
  | "create-events"
  | "applications"
  | "broadcasts"
  | "reports"
  | "tools"
  | "administration"
  | "profile";

type ToolsSection =
  | "home"
  | "volunteers"
  | "tasks"
  | "archived-events"
  | "email-templates"
  | "event-templates"
  | "broadcasts"
  | "ministry-registration"
  | "manage-ministry-membership";

type ToolsLaunch = {
  section: ToolsSection;
  key: number;
};

interface VolunteerOption {
  volunteer_id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  preferred_name?: string;
  email?: string;
  application_status: string;
  is_active: boolean;
}

interface VolunteerDirectoryPerson extends VolunteerOption {
  user_id?: string;
  home_campus: string;
  roles: string[];
  ministries: string[];
  scheduled_count?: number;
}

interface CommitmentItem {
  assignment_id?: string;
  assignment_status: string;
  attendance_status?: string;
  is_team_leader: boolean;
  event_group_id: string;
  event_group_name: string;
  event_group_description?: string;
  self_checkin_enabled: boolean;
  event_id: string;
  event_name: string;
  starts_at: string;
  ends_at: string;
  address: string;
  latitude: number;
  longitude: number;
  campus_name: string;
  campus_address: string;
}

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  location?: string;
  required_volunteers: number;
  claimed_volunteers: number;
  claimed_by_me: boolean;
  can_manage: boolean;
  claimed_volunteer_names: string[];
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "STAFFED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  event_name: string;
  event_group_name: string;
  campus_name: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

interface AdminTaskItem extends Omit<TaskItem, "claimed_by_me" | "can_manage"> {
  event_id: string;
  event_group_id: string;
  recipient_count: number;
  created_by?: string;
}

interface ConversationSummary {
  id: string;
  status: string;
  updated_at: string;
  event_name: string;
  event_group_name?: string;
  volunteer_name: string;
  leader_name: string;
  latest_message?: string;
  latest_message_at?: string;
  unread_count: number;
  is_leader: boolean;
}

interface ConversationMessage {
  id: string;
  body: string;
  channel: string;
  delivery_status: string;
  created_at: string;
  sender_user_id: string;
  sender_name: string;
  is_mine: boolean;
}

interface Campus {
  id: string;
  name: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  region: string;
  postal_code: string;
  country_code: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  is_active: boolean;
}

interface Ministry {
  id: string;
  name: string;
  description?: string;
  ministry_head_user_id?: string;
  ministry_head_name?: string;
  campus_leads?: MinistryCampusLead[];
  is_active: boolean;
}

interface MinistryCampusLead {
  campus_id: string;
  campus_name: string;
  lead_user_id?: string;
  lead_name?: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  created_by: string;
  creator_name: string;
  is_active: boolean;
  can_edit: boolean;
  updated_at: string;
}

interface EmailTemplateVariable {
  token: string;
  label: string;
  description: string;
  category: string;
  example: string;
}

interface EventTemplateTeam {
  name: string;
  description: string;
  instructions: string;
  leaderUserIds: string[];
  requiredVolunteerCount: number;
  signupPolicy: "AUTO" | "APPROVAL";
  movementPolicy: "AUTO" | "APPROVAL";
  selfCheckinEnabled: boolean;
}

interface EventTemplate {
  id: string;
  name: string;
  description: string;
  event_leader_user_ids: string[];
  teams: EventTemplateTeam[];
  created_by: string;
  creator_name: string;
  is_active: boolean;
  can_edit: boolean;
  updated_at: string;
}

interface EventLeader {
  id: string;
  display_name?: string;
  email: string;
  roles: string[];
  campus_ids?: string[];
}

interface AuditLogItem {
  id: number;
  actor_user_id?: string;
  actor_name: string;
  actor_email?: string;
  action: string;
  module: string;
  entity_type: string;
  entity_id?: string;
  entity_name?: string;
  details: Record<string, unknown>;
  ip_address?: string;
  occurred_at: string;
}

interface CampusCatalogItem {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface MinistryMembershipRequest {
  id: string;
  user_id?: string;
  volunteer_id?: string;
  ministry_id: string;
  ministry_name: string;
  campus_id: string;
  campus_name: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";
  requested_at: string;
  decided_at?: string;
  decision_reason?: string;
  decided_by_name?: string;
  user_name?: string;
  user_email?: string;
  volunteer_name?: string;
}

interface MinistryMember {
  user_id: string;
  ministry_id: string;
  ministry_name: string;
  campus_id?: string;
  campus_name?: string;
  assigned_at: string;
  user_name: string;
  user_email: string;
  volunteer_name?: string;
}

interface MinistryMembershipScope {
  isAdmin: boolean;
  ministries: Array<{ id: string; name: string }>;
  campuses: Array<{ id: string; name: string }>;
  ministryHeadIds: string[];
  campusLeadScopes: Array<{ ministry_id: string; campus_id: string }>;
}

interface SystemRole {
  code: string;
  name: string;
  description?: string;
  is_active: boolean;
  assignment_count: number;
}

interface UserRoleAssignment {
  id: string;
  display_name?: string;
  email: string;
  status: string;
  roles: string[];
}

interface ArchivedEvent {
  id: string;
  name: string;
  description: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  campus_name: string;
  address: string;
  latitude: number;
  longitude: number;
  event_leaders: string[];
}

const roleLabels = {
  ADMIN: "Church administrator",
  EVENT_LEADER: "Event leader",
  TEAM_LEADER: "Event team leader",
  MINISTRY_HEAD: "Ministry head",
  SCREENER: "Screener",
  VOLUNTEER: "Volunteer"
};
const eventStatuses: Array<{ value: EventStatus; label: string }> = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETE", label: "Complete" },
  { value: "DRAFT", label: "Draft" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REMOVED", label: "Removed" }
];
const demoAccounts = [
  { role: "ADMIN", email: "admin@volunteerhub.local", description: "Operations, compliance, and reporting" },
  { role: "EVENT_LEADER", email: "leader@volunteerhub.local", description: "Rosters, approvals, and attendance" },
  { role: "VOLUNTEER", email: "volunteer@volunteerhub.local", description: "Events, household, and schedule" }
] as const;
function hasRole(session: Session, role: UserRole) {
  return session.roles.some((assignedRole) => assignedRole.toUpperCase() === role);
}

function canScreenApplications(session: Session) {
  return hasRole(session, "ADMIN") || hasRole(session, "SCREENER");
}

function canManageEmailTemplates(session: Session) {
  return hasRole(session, "ADMIN") || hasRole(session, "EVENT_LEADER");
}

function canCreateBroadcasts(session: Session) {
  return canManageEmailTemplates(session) || hasRole(session, "TEAM_LEADER");
}

function canCreateOneOffEvents(session: Session) {
  return hasRole(session, "ADMIN") || hasRole(session, "EVENT_LEADER");
}

function canUseNonVolunteerTools(session: Session) {
  return session.roles.some((role) => role !== "VOLUNTEER");
}

function canUseArchivedEventTools(session: Session) {
  return hasRole(session, "ADMIN") || hasRole(session, "EVENT_LEADER");
}

function canManageMinistryMembershipTools(session: Session) {
  return (
    hasRole(session, "ADMIN") ||
    hasRole(session, "MINISTRY_HEAD") ||
    hasRole(session, "EVENT_LEADER") ||
    hasRole(session, "TEAM_LEADER") ||
    session.ministryIds.length > 0
  );
}

function eventHasPassed(event: Pick<EventItem, "ends_at">) {
  const endsAt = new Date(event.ends_at).getTime();
  return Number.isFinite(endsAt) && endsAt < Date.now();
}

function eventNeedsAction(event: Pick<EventItem, "status" | "ends_at">) {
  return (
    event.status === "DRAFT" || (eventHasPassed(event) && !["COMPLETE", "CANCELLED", "REMOVED"].includes(event.status))
  );
}

function eventStatusBadgeLabel(event: Pick<EventItem, "status" | "ends_at">) {
  if (event.status === "DRAFT") return "Draft";
  if (eventHasPassed(event) && !["COMPLETE", "CANCELLED", "REMOVED"].includes(event.status)) return "Expired";
  return formatRoleName(event.status);
}

function eventStatusBadgeTone(event: Pick<EventItem, "status" | "ends_at">) {
  if (eventNeedsAction(event)) return "action";
  if (event.status === "ACTIVE") return "active";
  return event.status.toLowerCase();
}

function formatRoleName(role: string) {
  if (role === "ADMIN") return "Administrator";
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatAuditAction(action: string) {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function auditDetailsSummary(details: Record<string, unknown>) {
  const entries = Object.entries(details ?? {}).filter(([, value]) => value !== null && value !== undefined);
  if (!entries.length) return "No extra details";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${formatRoleName(key)}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [view, setView] = useState<View>("serve");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [administrationKey, setAdministrationKey] = useState(0);
  const [toolsLaunch, setToolsLaunch] = useState<ToolsLaunch | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [activeTasks, setActiveTasks] = useState(0);
  const [pendingMinistryRequests, setPendingMinistryRequests] = useState(0);
  const [actionableEvents, setActionableEvents] = useState(0);
  const [pendingApplications, setPendingApplications] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(
    () =>
      observeAuth((user) => {
        if (!user) {
          setSession(null);
          setRestoring(false);
          return;
        }
        currentSession()
          .then((session) => {
            setSession(session);
            setView("serve");
          })
          .catch(() => setSession(null))
          .finally(() => setRestoring(false));
      }),
    []
  );
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const refreshUnreadMessages = async () => {
    if (!session) return setUnreadMessages(0);
    const conversations = await api<ConversationSummary[]>("/conversations");
    setUnreadMessages(conversations.reduce((total, conversation) => total + conversation.unread_count, 0));
  };
  const refreshActiveTasks = async () => {
    if (!session?.volunteerId) return setActiveTasks(0);
    const tasks = await api<TaskItem[]>("/my-tasks");
    setActiveTasks(tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)).length);
  };
  const refreshMinistryMembershipNotifications = async () => {
    if (!session || !canManageMinistryMembershipTools(session)) return setPendingMinistryRequests(0);
    const requests = await api<MinistryMembershipRequest[]>("/tools/ministry-membership/requests");
    setPendingMinistryRequests(requests.length);
  };
  const refreshEventNotifications = async () => {
    if (!session || !canCreateOneOffEvents(session)) return setActionableEvents(0);
    const events = await api<EventItem[]>("/events");
    setActionableEvents(events.filter(eventNeedsAction).length);
  };
  const refreshPendingApplications = async () => {
    if (!session || !canScreenApplications(session)) return setPendingApplications(0);
    const applications = await api<Array<Record<string, string | number>>>("/applications");
    setPendingApplications(applications.filter((application) => application.application_status === "SUBMITTED").length);
  };
  useEffect(() => {
    if (!session) return;
    void refreshUnreadMessages();
    void refreshActiveTasks();
    void refreshMinistryMembershipNotifications();
    void refreshEventNotifications();
    void refreshPendingApplications();
    const timer = window.setInterval(() => {
      void refreshUnreadMessages();
      void refreshActiveTasks();
      void refreshMinistryMembershipNotifications();
      void refreshEventNotifications();
      void refreshPendingApplications();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const enter = async (email: string, password: string) => {
    try {
      const user = await login(email, password);
      setSession(user);
      setView("serve");
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  if (restoring)
    return (
      <div className="loading-screen">
        <div className="brand">
          <span className="brand-mark login-panel-logo">
            <Sparkles size={20} />
          </span>
          <strong>Volunteer Hub</strong>
        </div>
      </div>
    );
  if (!session) return <Login onLogin={enter} notice={notice} />;

  const canUseApplications = canScreenApplications(session);
  const nav =
    canUseApplications || hasRole(session, "EVENT_LEADER") || session.ministryIds.length > 0
      ? ([
          ["serve", Home, "Home"],
          ["commitments", ClipboardCheck, "My Commitments"],
          ["tasks", ClipboardList, "My Tasks"],
          ["messages", MessageSquareText, "My Messages"],
          ...(hasRole(session, "ADMIN") || hasRole(session, "EVENT_LEADER")
            ? ([
                ["events", CalendarDays, "Events"],
                ["create-events", Plus, "Create Events", "child"]
              ] as const)
            : []),
          ...(canUseApplications ? ([["applications", UserCheck, "Applications"]] as const) : []),
          ["tools", Wrench, "Tools"],
          ...(hasRole(session, "ADMIN") || session.ministryIds.length > 0
            ? ([["administration", Settings, "Administration"]] as const)
            : []),
          ["profile", Users, "Profile"]
        ] as const)
      : ([
          ["serve", Home, "Home"],
          ["commitments", ClipboardCheck, "My Commitments"],
          ["tasks", ClipboardList, "My Tasks"],
          ["messages", MessageSquareText, "My Messages"],
          ["tools", Wrench, "Tools"],
          ["profile", Users, "Profile"]
        ] as const);

  const signOutUser = () => {
    void logout();
    setSession(null);
  };
  const openMinistryMembershipApprovals = () => {
    setToolsLaunch((current) => ({
      section: "manage-ministry-membership",
      key: (current?.key ?? 0) + 1
    }));
    setNotificationsOpen(false);
    setMenuOpen(false);
    setView("tools");
  };
  const openActionableEvents = () => {
    setNotificationsOpen(false);
    setMenuOpen(false);
    setView("events");
  };
  const openApplications = () => {
    setNotificationsOpen(false);
    setMenuOpen(false);
    setView("applications");
  };
  const notificationCount = pendingMinistryRequests + actionableEvents + pendingApplications;

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <span className="login-panel-logo"></span>
        </div>
        <div className="identity">
          <div className="avatar" aria-hidden="true">
            {initials(session.name)}
          </div>
          <div className="identity-details">
            <strong>{session.name}</strong>
            <span>{roleLabels[session.role]}</span>
            <small>{session.homeCampus}</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, Icon, label, itemType]) => (
            <button
              key={id}
              className={[view === id ? "active" : "", itemType === "child" ? "sub-nav" : ""].filter(Boolean).join(" ")}
              onClick={() => {
                if (id === "administration") setAdministrationKey((key) => key + 1);
                setView(id);
                setMenuOpen(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "messages" && unreadMessages > 0 && <strong className="nav-badge">{unreadMessages}</strong>}
              {id === "tasks" && activeTasks > 0 && <strong className="nav-badge">{activeTasks}</strong>}
              {id === "applications" && pendingApplications > 0 && (
                <strong className="nav-badge">{pendingApplications}</strong>
              )}
            </button>
          ))}
        </nav>
        <button className="logout" onClick={signOutUser}>
          <LogOut size={18} /> Sign out
        </button>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu />
          </button>
          <div className="search">
            <Search size={18} />
            <span>Search events, people, ministries</span>
          </div>
          <div className="notification-area">
            <button
              className="icon-button notification-button"
              aria-label={`Notifications${notificationCount ? `, ${notificationCount} pending` : ""}`}
              aria-expanded={notificationsOpen}
              type="button"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={19} />
              {notificationCount > 0 && <strong className="notification-badge">{notificationCount}</strong>}
            </button>
            {notificationsOpen && (
              <div className="notification-popover">
                <div className="notification-popover-header">
                  <strong>Notifications</strong>
                </div>
                {notificationCount > 0 ? (
                  <>
                    {pendingMinistryRequests > 0 && (
                      <button type="button" className="notification-item" onClick={openMinistryMembershipApprovals}>
                        <span>
                          <strong>
                            {pendingMinistryRequests} pending volunteer
                            {pendingMinistryRequests === 1 ? "" : "s"}
                          </strong>
                          <small>Review ministry membership requests</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    )}
                    {actionableEvents > 0 && (
                      <button type="button" className="notification-item" onClick={openActionableEvents}>
                        <span>
                          <strong>
                            {actionableEvents} event{actionableEvents === 1 ? "" : "s"} need attention
                          </strong>
                          <small>Publish drafts or close events past their end date</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    )}
                    {pendingApplications > 0 && (
                      <button type="button" className="notification-item" onClick={openApplications}>
                        <span>
                          <strong>
                            {pendingApplications} application{pendingApplications === 1 ? "" : "s"} need screening
                          </strong>
                          <small>Review new volunteer registrations and background checks</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    )}
                  </>
                ) : (
                  <p className="notification-empty">No items need attention.</p>
                )}
              </div>
            )}
          </div>
          <div className="avatar compact" aria-label={session.name}>
            {initials(session.name)}
          </div>
        </header>
        <div className="page">
          {notice && (
            <div className="toast">
              {notice}
              <button onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "serve" && <Events session={session} notify={setNotice} serveMode />}
          {view === "commitments" && <MyCommitments notify={setNotice} />}
          {view === "tasks" && <MyTasks notify={setNotice} />}
          {view === "messages" && <MyMessages notify={setNotice} onUnreadChange={refreshUnreadMessages} />}
          {view === "events" && <Events session={session} notify={setNotice} />}
          {view === "create-events" && (
            <CreateEventsPage session={session} notify={setNotice} close={() => setView("events")} />
          )}
          {view === "applications" && canUseApplications && (
            <Applications notify={setNotice} onApplicationsChanged={refreshPendingApplications} />
          )}
          {view === "reports" && <Reports />}
          {view === "tools" && (
            <Tools
              session={session}
              notify={setNotice}
              launch={toolsLaunch}
              pendingMinistryRequests={pendingMinistryRequests}
              onMembershipRequestsChanged={refreshMinistryMembershipNotifications}
            />
          )}
          {view === "administration" && (hasRole(session, "ADMIN") || session.ministryIds.length > 0) && (
            <Administration key={administrationKey} session={session} navigate={setView} notify={setNotice} />
          )}
          {view === "profile" && <Profile notify={setNotice} />}
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin, notice }: { onLogin: (email: string, password: string) => void; notice: string }) {
  const [registering, setRegistering] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onLogin(String(data.get("email")), String(data.get("password")));
  };
  return (
    <div className="login-page">
      <section className="login-story">
        {/* <div className="brand light">
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <strong>VolunteerHub</strong>
        </div>
        <div className="homepage-caption">
          <span className="eyebrow">Serve with confidence</span>
          <h1>
            You are
            <br />
            in the right place.
          </h1>
          <p>Coordinate your church's volunteers, protect your teams, and make serving feel simple.</p>
        </div>
        <div className="trust-row">
          <ShieldCheck />
          <span>Purpose-built for responsible volunteer care</span>
        </div> */}
      </section>
      <section className="login-panel">
        <div className="login-panel-content">
          <div className="login-panel-logo" aria-label="New Hope Church"></div>
          {registering ? (
            <Registration done={() => setRegistering(false)} />
          ) : (
            <>
              <div className="login-copy">
                <span className="eyebrow">Volunteer Hub</span>
                <h2>Sign in</h2>
                <p>Use your church volunteer account.</p>
                <br />
              </div>
              <form onSubmit={submit}>
                <Field name="email" label="Email" type="email" />
                <Field name="password" label="Password" type="password" />
                <button className="primary full">Sign in</button>
              </form>
              {notice && <p className="error">{notice}</p>}
              <button className="text-button" onClick={() => setRegistering(true)}>
                New volunteer? Submit an application
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function personName(firstName: unknown, middleName: unknown, lastName: unknown) {
  return [firstName, middleName, lastName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function Registration({ done }: { done: () => void }) {
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setStatus(null);

    if (data.password !== data.confirmPassword) {
      setStatus({
        type: "error",
        message: "Passwords do not match. Please enter the same password in both fields."
      });
      return;
    }

    try {
      await registerApplication({
        firstName: String(data.firstName),
        middleName: String(data.middleName ?? ""),
        lastName: String(data.lastName),
        email: String(data.email),
        phone: String(data.phone ?? ""),
        birthDate: String(data.birthDate),
        password: String(data.password),
        smsConsent: true
      });
      setStatus({
        type: "success",
        message: "An administrator will review it shortly."
      });
      window.setTimeout(done, 1200);
    } catch (error) {
      setStatus({ type: "error", message: (error as Error).message });
    }
  };
  return (
    <div className="registration">
      <button className="text-button" onClick={done}>
        ← Back to sign in
      </button>
      <h2>Volunteer application</h2>
      <p>Tell us a little about yourself to begin serving.</p>
      <form onSubmit={submit}>
        <Field name="firstName" label="First name" />
        <OptionalField name="middleName" label="Middle name (optional)" />
        <Field name="lastName" label="Last name" />
        <Field name="email" label="Email" type="email" />
        <Field name="phone" label="Mobile phone" />
        <Field name="birthDate" label="Birth date" type="date" />
        <Field name="password" label="Password" type="password" />
        <Field name="confirmPassword" label="Confirm password" type="password" />
        <button className="primary full">Submit application</button>
      </form>
      {status && (
        <div className={`form-message ${status.type}`} role={status.type === "error" ? "alert" : "status"}>
          <span className="form-message-icon" aria-hidden="true">
            {status.type === "success" ? <Check size={20} /> : <X size={20} />}
          </span>
          <span>
            <strong>{status.type === "success" ? "Application submitted" : "Please check your application"}</strong>
            <small>{status.message}</small>
          </span>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  session,
  navigate,
  notify
}: {
  session: Session;
  navigate: (view: View) => void;
  notify: (message: string) => void;
}) {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<EventItem[]>([]);
  const loadEvents = async () => {
    const rows = await api<EventItem[]>("/events");
    setEvents(rows);
    return rows;
  };
  useEffect(() => {
    api<Record<string, number>>("/dashboard").then(setStats);
    void loadEvents();
  }, []);
  if (session.role === "VOLUNTEER")
    return (
      <VolunteerHome session={session} events={events} refreshEvents={loadEvents} navigate={navigate} notify={notify} />
    );
  return (
    <div className="content-grid">
      <Card title="Needs attention">
        <div className="attention-list">
          <Attention
            icon={<UserCheck />}
            tone="amber"
            title={`${stats.pendingApplications ?? 0} applications waiting`}
            subtitle="Review volunteer applications"
          />
          <Attention
            icon={<Clock3 />}
            tone="blue"
            title={`${stats.pendingAssignments ?? 0} signup requests`}
            subtitle="Leaders can approve or reject"
          />
          <Attention
            icon={<ShieldCheck />}
            tone="rose"
            title={`${stats.expiringCompliance ?? 0} requirements expiring`}
            subtitle="Within the next 60 days"
          />
        </div>
      </Card>
    </div>
  );
}

function VolunteerHome({
  session,
  events,
  refreshEvents,
  navigate,
  notify
}: {
  session: Session;
  events: EventItem[];
  refreshEvents: () => Promise<EventItem[]>;
  navigate: (view: View) => void;
  notify: (message: string) => void;
}) {
  const [selected, setSelected] = useState<EventItem | null>(null);
  const homeCampusEvents = events.filter((event) => eventMatchesHomeCampus(event, session));
  const assigned = events.find((event) => event.my_assignments?.some((a) => a.status === "CONFIRMED"));
  const assignedGroupId = assigned?.my_assignments?.find(
    (assignment) => assignment.status === "CONFIRMED"
  )?.event_group_id;
  const assignedGroup = assigned?.groups.find((group) => group.id === assignedGroupId);
  const messageLeader = async () => {
    if (!assignedGroupId) return;
    const message = window.prompt("Message your assigned team leader");
    if (!message) return;
    try {
      await api("/conversations", { method: "POST", body: JSON.stringify({ eventGroupId: assignedGroupId, message }) });
      notify("Your message was queued through the private SMS relay.");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const refreshSelected = async (eventId: string) => {
    const rows = await refreshEvents();
    setSelected(rows.find((event) => event.id === eventId) ?? null);
  };
  const signup = async (event: EventItem, eventGroupId: string) => {
    try {
      const result = await api<{ status: string }>(`/event-groups/${eventGroupId}/signup`, {
        method: "POST",
        body: JSON.stringify({})
      });
      notify(result.status === "CONFIRMED" ? "You are confirmed to serve." : "Your request was sent.");
      await refreshSelected(event.id);
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const withdraw = async (event: EventItem, assignmentId: string) => {
    try {
      await api(`/assignments/${assignmentId}/cancel`, { method: "POST" });
      notify("You have withdrawn from this team.");
      await refreshSelected(event.id);
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="Welcome back, "
        title="Ready to make a difference?"
        description="Your next opportunity to serve is just around the corner."
      />
      {assigned && (
        <div className="hero-card">
          <div>
            <span className="pill light">Your next assignment</span>
            <h2>{assigned.name}</h2>
            <p>
              {formatDate(assigned.starts_at)} · {assignedGroup?.name}
            </p>
            <div className="hero-actions">
              <a
                className="light-button"
                href={`https://maps.google.com/?q=${assigned.latitude},${assigned.longitude}`}
                target="_blank"
              >
                <MapPin size={17} /> Directions
              </a>
              <button className="light-button" onClick={messageLeader}>
                <MessageSquareText size={17} /> Message leader
              </button>
            </div>
          </div>
          <div className="date-tile">
            <strong>{new Date(assigned.starts_at).getDate()}</strong>
            <span>{new Date(assigned.starts_at).toLocaleString("en", { month: "short" })}</span>
          </div>
        </div>
      )}
      <div className="section-title">
        <div>
          <h2>Volunteer Opportunities</h2>
        </div>
        <button onClick={() => navigate("serve")}>
          See all <ChevronRight size={16} />
        </button>
      </div>
      <div className="opportunity-grid">
        {homeCampusEvents.slice(0, 3).map((event) => (
          <Opportunity key={event.id} event={event} onOpen={() => setSelected(event)} />
        ))}
      </div>
      {selected && (
        <EventDrawer
          event={selected}
          session={session}
          serveMode
          breadcrumbLabel="Home"
          close={() => setSelected(null)}
          saved={() => setSelected(null)}
          notify={notify}
          onSignup={signup}
          onWithdraw={withdraw}
        />
      )}
    </>
  );
}

function Events({
  session,
  notify,
  serveMode = false
}: {
  session: Session;
  notify: (message: string) => void;
  serveMode?: boolean;
}) {
  const canManageAllEvents = !serveMode && canCreateOneOffEvents(session);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventSearch, setEventSearch] = useState("");
  const [locationScope, setLocationScope] = useState<"MY_CAMPUS" | "ALL">(() =>
    canManageAllEvents ? "ALL" : "MY_CAMPUS"
  );
  const [searchingEvents, setSearchingEvents] = useState(false);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [editSelected, setEditSelected] = useState(false);
  const [managing, setManaging] = useState<EventItem | null>(null);
  const [editingTeam, setEditingTeam] = useState<EventGroupItem | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const debouncedEventSearch = useDebouncedValue(eventSearch);
  const load = useCallback(
    async ({ signal }: { signal?: AbortSignal; force?: boolean } = {}) => {
      const params = new URLSearchParams();
      if (serveMode) params.set("serve", "true");
      if (debouncedEventSearch.trim().length >= 2) params.set("q", debouncedEventSearch.trim());
      const path = `/events${params.size ? `?${params}` : ""}`;
      setSearchingEvents(true);
      try {
        const rows = await api<EventItem[]>(path, { signal });
        setEvents(rows);
        setSelected((current) => (current ? (rows.find((event) => event.id === current.id) ?? null) : null));
        setManaging((current) => (current ? (rows.find((event) => event.id === current.id) ?? null) : null));
      } finally {
        setSearchingEvents(false);
      }
    },
    [debouncedEventSearch, serveMode]
  );
  const refreshEvents = useCallback(() => {
    return load({ force: true });
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal }).catch((error) => {
      if ((error as Error).name !== "AbortError") notify((error as Error).message);
    });
    return () => controller.abort();
  }, [load, notify]);
  const visibleEvents = events.filter(
    (event) =>
      locationScope === "ALL" ||
      (canManageAllEvents && event.status === "DRAFT") ||
      eventMatchesHomeCampus(event, session)
  );
  const groupedEvents = [...visibleEvents]
    .sort((first, second) => new Date(first.starts_at).getTime() - new Date(second.starts_at).getTime())
    .reduce<Array<{ key: string; label: string; items: EventItem[] }>>((groups, event) => {
      const date = new Date(event.starts_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const current = groups.find((group) => group.key === key);
      if (current) current.items.push(event);
      else groups.push({ key, label: date.toLocaleString("en-US", { month: "long" }), items: [event] });
      return groups;
    }, []);
  const signup = async (event: EventItem, eventGroupId: string, volunteerId?: string) => {
    try {
      const result = await api<{ status: string }>(`/event-groups/${eventGroupId}/signup`, {
        method: "POST",
        body: JSON.stringify({ volunteerId })
      });
      notify(
        result.status === "CONFIRMED"
          ? volunteerId
            ? "Volunteer confirmed to serve."
            : "You are confirmed to serve."
          : volunteerId
            ? "Volunteer request sent to the team leader."
            : "Your request was sent to the team leader."
      );
      void refreshEvents();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const withdraw = async (event: EventItem, assignmentId: string) => {
    try {
      await api(`/assignments/${assignmentId}/cancel`, { method: "POST" });
      notify("You have withdrawn from this team.");
      await refreshEvents();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  if (managing)
    return (
      <>
        <EventTeamManagement
          event={managing}
          session={session}
          back={() => setManaging(null)}
          addTeam={() => setEditingTeam(null)}
          editTeam={(team) => setEditingTeam(team)}
        />
        {editingTeam !== undefined && (
          <EventTeamEditor
            event={managing}
            team={editingTeam}
            close={() => setEditingTeam(undefined)}
            saved={async () => {
              setEditingTeam(undefined);
              await refreshEvents();
            }}
            notify={notify}
          />
        )}
      </>
    );
  return (
    <>
      <PageTitle
        eyebrow="SERVE"
        title={serveMode ? "Find a place to serve" : "Events and Teams"}
        description={
          serveMode
            ? "Explore opportunities that match your ministry eligibility."
            : "Track staffing, approvals, and attendance."
        }
      />
      <div className="filter-bar event-filter-bar">
        <div className="search active">
          <Search size={17} />
          <label className="sr-only" htmlFor="event-search">
            {serveMode ? "Search upcoming events" : "Search events"}
          </label>
          <input
            id="event-search"
            value={eventSearch}
            type="search"
            placeholder={serveMode ? "Search upcoming events" : "Search events"}
            onChange={(event) => setEventSearch(event.target.value)}
          />
          {searchingEvents && <span className="searching-indicator">Searching…</span>}
        </div>
        <div className="location-filter" aria-label="Event location filter">
          <button
            type="button"
            className={locationScope === "MY_CAMPUS" ? "active" : ""}
            onClick={() => setLocationScope("MY_CAMPUS")}
          >
            My Campus
          </button>
          <button
            type="button"
            className={locationScope === "ALL" ? "active" : ""}
            onClick={() => setLocationScope("ALL")}
          >
            All Locations
          </button>
        </div>
        {!serveMode && canCreateOneOffEvents(session) && (
          <button className="primary" onClick={() => setCreating(true)}>
            + Create event
          </button>
        )}
      </div>
      {serveMode ? (
        groupedEvents.length ? (
          <div className="serve-event-months">
            {groupedEvents.map((group) => (
              <section className="serve-event-month" key={group.key}>
                <div className="serve-month-heading">
                  <h2>{group.label}</h2>
                  <span aria-hidden="true" />
                </div>
                <div className="events-grid">
                  {group.items.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      session={session}
                      serveMode
                      onOpen={() => {
                        setEditSelected(false);
                        setSelected(event);
                      }}
                      onEdit={() => {
                        setEditSelected(true);
                        setSelected(event);
                      }}
                      onManage={() => setManaging(event)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <Empty text={eventSearch ? "No upcoming events match your search." : "There are no upcoming events."} />
        )
      ) : groupedEvents.length ? (
        <div className="serve-event-months">
          {groupedEvents.map((group) => (
            <section className="serve-event-month" key={group.key}>
              <div className="serve-month-heading">
                <h2>{group.label}</h2>
                <span aria-hidden="true" />
              </div>
              <div className="events-grid">
                {group.items.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    session={session}
                    serveMode={false}
                    onOpen={() => {
                      setEditSelected(false);
                      setSelected(event);
                    }}
                    onEdit={() => {
                      setEditSelected(true);
                      setSelected(event);
                    }}
                    onManage={() => setManaging(event)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          text={
            eventSearch
              ? "No events match your search."
              : locationScope === "MY_CAMPUS"
                ? "There are no events for your campus or off-site locations."
                : "There are no events."
          }
        />
      )}
      {selected && (
        <EventDrawer
          event={selected}
          session={session}
          serveMode={serveMode}
          breadcrumbLabel={serveMode ? "Serve" : "Events and Teams"}
          initialEditing={editSelected}
          close={() => setSelected(null)}
          saved={() => {
            setSelected(null);
            void refreshEvents();
          }}
          notify={notify}
          onSignup={signup}
          onWithdraw={withdraw}
        />
      )}
      {creating && (
        <CreateEvent
          close={() => setCreating(false)}
          saved={() => {
            setCreating(false);
            void refreshEvents();
            notify("Event created as Draft.");
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function MyCommitments({ notify }: { notify: (message: string) => void }) {
  const [commitments, setCommitments] = useState<CommitmentItem[]>([]);
  const [messageCommitment, setMessageCommitment] = useState<CommitmentItem | null>(null);
  const [groupChatCommitment, setGroupChatCommitment] = useState<CommitmentItem | null>(null);
  const load = () => api<CommitmentItem[]>("/my-commitments").then(setCommitments);
  useEffect(() => {
    void load();
  }, []);
  const grouped = commitments.reduce<Array<{ key: string; label: string; items: CommitmentItem[] }>>(
    (groups, commitment) => {
      const date = new Date(commitment.starts_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const current = groups.find((group) => group.key === key);
      if (current) current.items.push(commitment);
      else groups.push({ key, label: date.toLocaleString("en-US", { month: "long" }), items: [commitment] });
      return groups;
    },
    []
  );
  const checkIn = async (commitment: CommitmentItem) => {
    if (!commitment.assignment_id) return;
    const submit = async (location?: { latitude: number; longitude: number }) => {
      try {
        await api(`/assignments/${commitment.assignment_id}/checkin`, {
          method: "POST",
          body: JSON.stringify(location ?? {})
        });
        notify("Check-in complete.");
        await load();
      } catch (error) {
        notify((error as Error).message);
      }
    };
    if (!commitment.self_checkin_enabled) return void submit();
    if (!navigator.geolocation) return notify("Location services are unavailable on this device.");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => void submit({ latitude: coords.latitude, longitude: coords.longitude }),
      () => notify("Location access is required to check in."),
      { enableHighAccuracy: true }
    );
  };
  const messageLeader = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!messageCommitment) return;
    const message = String(new FormData(formEvent.currentTarget).get("message") ?? "").trim();
    if (!message) return;
    try {
      await api("/conversations", {
        method: "POST",
        body: JSON.stringify({ eventGroupId: messageCommitment.event_group_id, message })
      });
      setMessageCommitment(null);
      notify("Your message was queued through the private SMS relay.");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  if (groupChatCommitment)
    return (
      <Suspense fallback={<div className="chat-page-state">Opening Team Chat…</div>}>
        <GroupChat
          eventGroupId={groupChatCommitment.event_group_id}
          close={() => setGroupChatCommitment(null)}
          notify={notify}
        />
      </Suspense>
    );
  return (
    <>
      <PageTitle
        eyebrow="Schedule"
        title="My Commitments"
        description="Review the event teams you have committed to serve with."
      />
      {grouped.length ? (
        <div className="commitment-months">
          {grouped.map((group) => (
            <section className="commitment-month" key={group.key}>
              <h2>{group.label}</h2>
              <div className="commitment-list">
                {group.items.map((commitment) => (
                  <article
                    className="commitment-row"
                    key={`${commitment.event_group_id}-${commitment.assignment_id ?? "leader"}`}
                  >
                    <div className="calendar-block">
                      <strong>{new Date(commitment.starts_at).getDate()}</strong>
                      <span>{new Date(commitment.starts_at).toLocaleString("en-US", { month: "short" })}</span>
                    </div>
                    <span className="commitment-details">
                      <span className="ministry">{commitment.event_group_name}</span>
                      <strong>{commitment.event_name}</strong>
                      {commitment.is_team_leader && <span className="commitment-leader-label">Team leader</span>}
                      <small>
                        <Clock3 size={14} /> {formatDateRange(commitment.starts_at, commitment.ends_at)}
                      </small>
                      <small>
                        <MapPin size={14} /> {commitmentLocation(commitment)}
                      </small>
                    </span>
                    <span className="commitment-actions">
                      <button
                        className="commitment-action-button"
                        disabled={
                          !commitment.is_team_leader &&
                          !["CONFIRMED", "COMPLETED"].includes(commitment.assignment_status)
                        }
                        title={
                          commitment.is_team_leader || ["CONFIRMED", "COMPLETED"].includes(commitment.assignment_status)
                            ? "Open this event team's private group chat"
                            : "Group chat is available after your assignment is confirmed"
                        }
                        onClick={() => setGroupChatCommitment(commitment)}
                      >
                        <Users size={16} /> Group chat
                      </button>
                      {commitment.assignment_id && (
                        <button className="commitment-action-button" onClick={() => setMessageCommitment(commitment)}>
                          <MessageSquareText size={16} /> Message leader
                        </button>
                      )}
                      <a
                        className="commitment-action-button"
                        href={googleMapsDirectionsUrl(commitment)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={16} /> Directions
                      </a>
                      {commitment.assignment_id &&
                      (commitment.attendance_status === "CHECKED_IN" || commitment.attendance_status === "PRESENT") ? (
                        <span className="status confirmed">Checked in</span>
                      ) : commitment.assignment_id && commitment.assignment_status === "CONFIRMED" ? (
                        <button className="commitment-action-button checkin-button" onClick={() => checkIn(commitment)}>
                          Check-in
                        </button>
                      ) : commitment.assignment_id ? (
                        <span className={`status ${commitment.assignment_status.toLowerCase()}`}>
                          {commitment.assignment_status.toLowerCase()}
                        </span>
                      ) : null}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty text="You have no volunteer commitments yet." />
      )}
      {messageCommitment && (
        <div className="confirmation-backdrop" onClick={() => setMessageCommitment(null)}>
          <form
            className="confirmation-dialog message-composer"
            onSubmit={messageLeader}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="confirmation-icon">
              <MessageSquareText size={22} />
            </span>
            <div>
              <span className="eyebrow">{messageCommitment.event_name}</span>
              <h3>Message the {messageCommitment.event_group_name} leader</h3>
              <p>Your message will be sent through the private messaging relay.</p>
            </div>
            <label>
              Message
              <textarea name="message" rows={4} placeholder="Write your message" autoFocus required />
            </label>
            <div className="confirmation-actions">
              <button className="secondary" type="button" onClick={() => setMessageCommitment(null)}>
                Cancel
              </button>
              <button className="primary">
                <MessageSquareText size={16} /> Send message
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function MyTasks({ notify }: { notify: (message: string) => void }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const load = async () => setTasks(await api<TaskItem[]>("/my-tasks"));
  useEffect(() => {
    void load().catch((error) => notify((error as Error).message));
    const timer = window.setInterval(() => void load(), 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);
  const act = async (task: TaskItem, action: "claim" | "withdraw" | "start" | "complete") => {
    try {
      await api(`/tasks/${task.id}/${action}`, { method: "POST", body: "{}" });
      notify(
        action === "claim"
          ? "Task claimed."
          : action === "withdraw"
            ? "You withdrew from the task."
            : action === "start"
              ? "Task started."
              : "Task completed."
      );
      await load();
    } catch (error) {
      notify((error as Error).message);
      await load();
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="Operations"
        title="My Tasks"
        description="Claim and complete requests assigned to the event teams you are serving with."
      />
      <Card title="Tasks">
        <div className="my-task-list">
          {tasks.map((task) => {
            const taskDate = new Date(task.starts_at);
            const staffingPercent = Math.min(100, (task.claimed_volunteers / task.required_volunteers) * 100);
            return (
              <article className="my-task-row" key={task.id}>
                <span className="task-date">
                  <strong>{taskDate.getDate()}</strong>
                  <small>{taskDate.toLocaleString("en-US", { month: "short" })}</small>
                </span>
                <div className="my-task-content">
                  <strong>{task.title}</strong>
                  <small>
                    {task.event_name} · {task.event_group_name}
                  </small>
                  <small>
                    {formatDateRange(task.starts_at, task.ends_at)} · {task.location || task.campus_name}
                  </small>
                  {task.description && <p>{task.description}</p>}
                  <div className="my-task-staffing">
                    <span className="claim-count-badge">
                      <strong>
                        {task.claimed_volunteers}/{task.required_volunteers}
                      </strong>
                      <small>claimed</small>
                    </span>
                    <span className="my-task-progress">
                      <i style={{ width: `${staffingPercent}%` }} />
                    </span>
                  </div>
                  <div className="my-task-row-actions">
                    <span className={`status ${task.status.toLowerCase()}`}>{formatRoleName(task.status)}</span>
                    {task.status === "OPEN" && !task.claimed_by_me && (
                      <button className="secondary" onClick={() => void act(task, "claim")}>
                        <UserCheck size={16} /> Claim task
                      </button>
                    )}
                    {task.claimed_by_me && (task.status === "OPEN" || task.status === "STAFFED") && (
                      <button className="secondary" onClick={() => void act(task, "withdraw")}>
                        Withdraw
                      </button>
                    )}
                    {task.claimed_by_me && task.status === "STAFFED" && (
                      <button className="primary" onClick={() => void act(task, "start")}>
                        Start task
                      </button>
                    )}
                    {(task.claimed_by_me || task.can_manage) && task.status === "IN_PROGRESS" && (
                      <button className="primary" onClick={() => void act(task, "complete")}>
                        <Check size={16} /> Mark complete
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!tasks.length && <Empty text="You have no active tasks." />}
        </div>
      </Card>
    </>
  );
}

function MyMessages({
  notify,
  onUnreadChange
}: {
  notify: (message: string) => void;
  onUnreadChange: () => Promise<void>;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const loadConversations = async () => {
    const rows = await api<ConversationSummary[]>("/conversations");
    setConversations(rows);
    setSelected((current) => (current ? (rows.find((item) => item.id === current.id) ?? null) : null));
    await onUnreadChange();
  };
  const openConversation = async (conversation: ConversationSummary) => {
    setSelected(conversation);
    setMessages(await api<ConversationMessage[]>(`/conversations/${conversation.id}/messages`));
    await loadConversations();
  };
  useEffect(() => {
    void loadConversations();
  }, []);
  const reply = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!selected) return;
    const form = formEvent.currentTarget;
    const message = String(new FormData(form).get("message") ?? "").trim();
    if (!message) return;
    try {
      await api(`/conversations/${selected.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message })
      });
      form.reset();
      setMessages(await api<ConversationMessage[]>(`/conversations/${selected.id}/messages`));
      await loadConversations();
      notify("Message queued for masked SMS delivery.");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const counterpart = (conversation: ConversationSummary) =>
    conversation.is_leader ? conversation.volunteer_name : conversation.leader_name;
  return (
    <>
      {selected && (
        <nav className="chat-page-breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => setSelected(null)}>
            Conversations <ChevronRight size={16} />
          </button>
        </nav>
      )}
      <PageTitle
        eyebrow="Communication"
        title={
          selected
            ? `${selected.event_name} – ${selected.event_group_name || "Event team"} – Leader Chat`
            : "My Messages"
        }
        description={selected ? undefined : ""}
      />
      <div className={`messages-layout ${selected ? "thread-open" : ""}`}>
        {!selected ? (
          <section className="conversation-panel">
            {conversations.length ? (
              <div className="conversation-list">
                {conversations.map((conversation) => (
                  <button
                    className="conversation-summary"
                    key={conversation.id}
                    onClick={() => void openConversation(conversation)}
                  >
                    <span className="avatar compact" aria-hidden="true">
                      {initials(counterpart(conversation))}
                    </span>
                    <span className="grow">
                      <strong>{counterpart(conversation)}</strong>
                      <small>
                        {conversation.event_name} · {conversation.event_group_name || "Event team"}
                      </small>
                      <span>{conversation.latest_message || "Start the conversation"}</span>
                    </span>
                    {conversation.unread_count > 0 && (
                      <strong className="message-badge">{conversation.unread_count}</strong>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <Empty text="You have no messages yet." />
            )}
          </section>
        ) : (
          <section className="message-thread chat-page-surface" aria-label={`${counterpart(selected)} Leader Chat`}>
            <div className="message-history chat-page-history">
              {messages.map((message) => (
                <div className={message.is_mine ? "message-bubble mine" : "message-bubble"} key={message.id}>
                  <p>{message.body}</p>
                  <small>
                    {message.is_mine ? "You" : message.sender_name} · {formatMessageTime(message.created_at)}
                  </small>
                </div>
              ))}
            </div>
            <form className="message-reply chat-page-compose" onSubmit={reply}>
              <textarea name="message" rows={2} placeholder="Write a message" required />
              <button className="primary">
                <MessageSquareText size={16} /> Send
              </button>
            </form>
          </section>
        )}
      </div>
    </>
  );
}

function CreateEvent({
  close,
  saved,
  notify
}: {
  close: () => void;
  saved: () => void;
  notify: (message: string) => void;
}) {
  const [catalog, setCatalog] = useState<{ campuses: CampusCatalogItem[] }>({ campuses: [] });
  const [leaders, setLeaders] = useState<EventLeader[]>([]);
  const [campusId, setCampusId] = useState("");
  const [location, setLocation] = useState({ address: "", latitude: "", longitude: "" });
  const useCampusLocation = (campus: CampusCatalogItem) => {
    setCampusId(campus.id);
    setLocation({
      address: campus.address ?? "",
      latitude: campus.latitude === null || campus.latitude === undefined ? "" : String(campus.latitude),
      longitude: campus.longitude === null || campus.longitude === undefined ? "" : String(campus.longitude)
    });
  };
  useEffect(() => {
    Promise.all([api<typeof catalog>("/catalog"), api<EventLeader[]>("/administration/event-leaders")]).then(
      ([catalogRows, leaderRows]) => {
        setCatalog(catalogRows);
        setLeaders(leaderRows);
        if (catalogRows.campuses[0]) useCampusLocation(catalogRows.campuses[0]);
      }
    );
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    try {
      await api("/events", {
        method: "POST",
        body: JSON.stringify({
          campusId: String(data.campusId),
          name: data.name,
          description: data.description,
          startsAt: new Date(String(data.startsAt)).toISOString(),
          endsAt: new Date(String(data.endsAt)).toISOString(),
          address: data.address,
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
          eventLeaderUserIds: formData.getAll("eventLeaderUserIds")
        })
      });
      saved();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={close}>
          <X />
        </button>
        <span className="eyebrow">Administration</span>
        <h2>Create an event</h2>
        <p>Create the event details, then add the volunteer teams that will serve at it.</p>
        <form onSubmit={submit}>
          <Field name="name" label="Event name" />
          <label>
            Description
            <textarea name="description" rows={3} required />
          </label>
          <label>
            Campus
            <select
              name="campusId"
              value={campusId}
              required
              onChange={(event) => {
                const campus = catalog.campuses.find((item) => item.id === event.target.value);
                if (campus) useCampusLocation(campus);
              }}
            >
              {catalog.campuses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="two-col">
            <DateTimeField name="startsAt" label="Starts" />
            <DateTimeField name="endsAt" label="Ends" />
          </div>
          <label>
            Address
            <input
              name="address"
              value={location.address}
              required
              onChange={(event) => setLocation({ ...location, address: event.target.value })}
            />
          </label>
          <div className="two-col">
            <LocationField
              name="latitude"
              label="Latitude"
              value={location.latitude}
              onChange={(value) => setLocation({ ...location, latitude: value })}
            />
            <LocationField
              name="longitude"
              label="Longitude"
              value={location.longitude}
              onChange={(value) => setLocation({ ...location, longitude: value })}
            />
          </div>
          <LeaderSelector leaders={leaders} selectedIds={[]} />
          <button className="primary full">Create event</button>
        </form>
      </aside>
    </div>
  );
}

function EventCard({
  event,
  session,
  serveMode,
  onOpen,
  onEdit,
  onManage
}: {
  event: EventItem;
  session: Session;
  serveMode: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onManage: () => void;
}) {
  const percentage = Math.min(100, Math.round((event.confirmed_count / Math.max(1, event.required_count)) * 100));
  const needsAction = eventNeedsAction(event);
  return (
    <article className={["event-card", needsAction ? "event-card-actionable" : ""].filter(Boolean).join(" ")}>
      <div className="event-card-top">
        <div className="event-card-tiles">
          <div className="calendar-block">
            <strong>{new Date(event.starts_at).getDate()}</strong>
            <span>{new Date(event.starts_at).toLocaleString("en", { month: "short" })}</span>
          </div>
          <div className="calendar-block team-count-tile">
            <strong>{event.groups.length}</strong>
            <span>{event.groups.length === 1 ? "Team" : "Teams"}</span>
          </div>
          <span className={`event-status-badge ${eventStatusBadgeTone(event)}`}>
            <strong>1</strong>
            <span>{eventStatusBadgeLabel(event)}</span>
          </span>
        </div>
        {!serveMode && hasRole(session, "ADMIN") ? (
          <div className="event-card-top-actions">
            <button className="secondary" onClick={onEdit}>
              <Pencil size={15} /> Edit
            </button>
          </div>
        ) : null}
      </div>
      <h3>{event.name}</h3>
      <p className="meta">
        <Clock3 size={15} /> {formatDateRange(event.starts_at, event.ends_at)}
      </p>
      <p className="meta">
        <MapPin size={15} /> {eventLocation(event)}
      </p>
      {serveMode ? (
        <div className="card-actions">
          <a
            className="secondary event-directions"
            href={googleMapsDirectionsUrl(event)}
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={15} /> Directions
          </a>
          <button className="secondary" onClick={onOpen}>
            Volunteer Here
          </button>
        </div>
      ) : (
        <div className="staffing">
          <div>
            <span>Staffed</span>
            <strong>
              {event.confirmed_count}/{event.required_count}
            </strong>
          </div>
          <div className="progress">
            <i style={{ width: `${percentage}%` }} />
          </div>
          <button className="secondary full" onClick={onManage}>
            Manage Teams
          </button>
        </div>
      )}
    </article>
  );
}

function EventTeamManagement({
  event,
  session,
  back,
  addTeam,
  editTeam
}: {
  event: EventItem;
  session: Session;
  back: () => void;
  addTeam: () => void;
  editTeam: (team: EventGroupItem) => void;
}) {
  const [leaders, setLeaders] = useState<EventLeader[]>([]);
  useEffect(() => {
    if (hasRole(session, "ADMIN")) void api<EventLeader[]>("/administration/team-leaders").then(setLeaders);
  }, [session]);
  return (
    <>
      <Breadcrumbs items={[{ label: "Events and Teams", onClick: back }, { label: event.name }]} />
      <PageTitle
        eyebrow="Schedule"
        title="Event Team Management"
        description={`Manage teams, staffing, and policies for ${event.name}.`}
      />
      <section className="event-management-banner">
        <div>
          <span className="eyebrow">Event details</span>
          <h2>{event.name}</h2>
          <p>{event.description || "No event description has been added."}</p>
        </div>
        <div className="event-management-facts">
          <span className="event-date-fact">
            <CalendarDays size={18} />
            <span className="event-date-range">
              <span>
                <strong>{formatDate(event.starts_at)}&nbsp;-</strong>
              </span>
              <span>
                <strong>{formatDate(event.ends_at)}</strong>
              </span>
            </span>
          </span>
          <span>
            <MapPin size={18} />
            <strong>{eventLocation(event)}</strong>
          </span>
          <span>
            <Users size={18} />
            <strong>
              {event.confirmed_count}/{event.required_count} staffed
            </strong>
          </span>
          <span>
            <ClipboardCheck size={18} />
            <strong>
              {event.groups.length} team{event.groups.length === 1 ? "" : "s"}
            </strong>
          </span>
        </div>
      </section>
      <Card
        title="Teams"
        action={
          hasRole(session, "ADMIN") ? (
            <button onClick={addTeam}>
              <Plus size={16} /> Add event team
            </button>
          ) : undefined
        }
      >
        <div className="ministry-group event-team-group">
          <div className="table campus-table event-team-table">
            {event.groups.map((team) => (
              <EventTeamRow
                key={team.id}
                team={team}
                leaders={leaders.filter((leader) => team.leader_user_ids.includes(leader.id))}
                canEdit={hasRole(session, "ADMIN")}
                onEdit={() => editTeam(team)}
              />
            ))}
            {!event.groups.length && <Empty text="No event teams have been added yet." />}
          </div>
        </div>
      </Card>
    </>
  );
}

function EventTeamRow({
  team,
  leaders,
  canEdit,
  onEdit
}: {
  team: EventGroupItem;
  leaders: EventLeader[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="table-row event-team-row">
      <span className="attention-icon blue">
        <Users size={19} />
      </span>
      <span className="grow">
        <strong>{team.name}</strong>
        <small>{team.description || "No description"}</small>
      </span>
      {canEdit && (
        <button className="secondary event-team-edit" onClick={onEdit}>
          <Pencil size={15} /> Edit
        </button>
      )}
      <div className="team-card-metrics compact">
        <span>
          <strong>{team.required_count}</strong>
          <small>Target</small>
        </span>
        <span>
          <strong>{team.confirmed_count}</strong>
          <small>Staffed</small>
        </span>
        <span>
          <strong>{team.open_count}</strong>
          <small>Open</small>
        </span>
        <span>
          <strong>{team.pending_count}</strong>
          <small>Pending</small>
        </span>
      </div>
      <span className={`policy ${team.signup_policy === "AUTO" ? "auto" : "approval"}`}>
        {team.signup_policy === "AUTO" ? "Automatic" : "Approval"}
      </span>
      <span className="event-team-leaders">
        <small>Leaders</small>
        <strong>
          {leaders.length
            ? leaders.map((leader) => leader.display_name || leader.email).join(", ")
            : "No leaders assigned"}
        </strong>
      </span>
    </div>
  );
}

function EventTeamEditor({
  event,
  team,
  close,
  saved,
  notify
}: {
  event: EventItem;
  team: EventGroupItem | null;
  close: () => void;
  saved: () => void;
  notify: (message: string) => void;
}) {
  const [leaders, setLeaders] = useState<EventLeader[]>([]);
  useEffect(() => {
    api<EventLeader[]>("/administration/team-leaders").then(setLeaders);
  }, []);
  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    const data = Object.fromEntries(formData);
    try {
      await api(team ? `/event-groups/${team.id}` : `/events/${event.id}/groups`, {
        method: team ? "PATCH" : "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          instructions: data.instructions,
          leaderUserIds: formData.getAll("teamLeaderUserIds"),
          requiredVolunteerCount: Number(data.requiredVolunteerCount),
          signupPolicy: data.signupPolicy,
          movementPolicy: data.movementPolicy,
          selfCheckinEnabled: data.selfCheckinEnabled === "on",
          isActive: true
        })
      });
      notify(team ? "Event team updated." : "Event team added.");
      saved();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <button className="drawer-close" onClick={close}>
          <X />
        </button>
        <span className="eyebrow">{event.name}</span>
        <h2>{team ? "Manage event team" : "Add event team"}</h2>
        <p>
          {team
            ? "Update this team's staffing and serving policies."
            : "Create a team for volunteers serving at this event."}
        </p>
        <form className="drawer-form" onSubmit={submit}>
          <Field name="name" label="Team name" defaultValue={team?.name} />
          <label>
            Description
            <textarea name="description" rows={3} defaultValue={team?.description} required />
          </label>
          <label>
            Instructions
            <textarea name="instructions" rows={3} defaultValue={team?.instructions} />
          </label>
          <Field
            name="requiredVolunteerCount"
            label="Volunteers required"
            type="number"
            defaultValue={team?.required_count ?? 0}
          />
          <LeaderSelector
            leaders={leaders}
            selectedIds={team?.leader_user_ids ?? []}
            inputName="teamLeaderUserIds"
            title="Team leaders"
            searchPlaceholder="Search Administrators, Event Leaders, or Team Leaders"
            emptyMessage="No active Administrators, Event Leaders, or Team Leaders are available."
          />
          <div className="two-col">
            <label>
              Signup policy
              <select name="signupPolicy" defaultValue={team?.signup_policy ?? "AUTO"}>
                <option value="AUTO">Automatic confirmation</option>
                <option value="APPROVAL">Leader approval</option>
              </select>
            </label>
            <label>
              Move/swap policy
              <select name="movementPolicy" defaultValue={team?.movement_policy ?? "AUTO"}>
                <option value="AUTO">Automatic confirmation</option>
                <option value="APPROVAL">Leader approval</option>
              </select>
            </label>
          </div>
          <label className="check-label">
            <input name="selfCheckinEnabled" type="checkbox" defaultChecked={team?.self_checkin_enabled ?? false} />
            Enable location-bound self check-in
          </label>
          <button className="primary full">{team ? "Save event team" : "Add event team"}</button>
        </form>
      </aside>
    </div>
  );
}

function EventDrawer({
  event,
  session,
  serveMode,
  breadcrumbLabel,
  proxyVolunteerId,
  initialEditing = false,
  close,
  saved,
  notify,
  onSignup,
  onWithdraw
}: {
  event: EventItem;
  session: Session;
  serveMode: boolean;
  breadcrumbLabel: string;
  proxyVolunteerId?: string;
  initialEditing?: boolean;
  close: () => void;
  saved: () => void;
  notify: (m: string) => void;
  onSignup: (event: EventItem, eventGroupId: string, volunteerId?: string) => void;
  onWithdraw: (event: EventItem, assignmentId: string) => void;
}) {
  const [roster, setRoster] = useState<Array<Record<string, string | number>>>([]);
  const [teams, setTeams] = useState(event.groups);
  const [addingTeam, setAddingTeam] = useState(false);
  const [editingEvent, setEditingEvent] = useState(initialEditing);
  const [leaders, setLeaders] = useState<EventLeader[]>([]);
  const [campuses, setCampuses] = useState<CampusCatalogItem[]>([]);
  const [editCampusId, setEditCampusId] = useState(event.campus_id);
  const [editLocation, setEditLocation] = useState({
    address: event.address,
    latitude: String(event.latitude),
    longitude: String(event.longitude)
  });
  const useEditCampusLocation = (campus: CampusCatalogItem) => {
    setEditCampusId(campus.id);
    setEditLocation({
      address: campus.address ?? "",
      latitude: campus.latitude === null || campus.latitude === undefined ? "" : String(campus.latitude),
      longitude: campus.longitude === null || campus.longitude === undefined ? "" : String(campus.longitude)
    });
  };
  useEffect(() => {
    if (!serveMode && session.role !== "VOLUNTEER")
      api<Array<Record<string, string | number>>>(`/events/${event.id}/roster`).then(setRoster);
    if (!serveMode && hasRole(session, "ADMIN"))
      Promise.all([
        api<{ campuses: CampusCatalogItem[] }>("/catalog"),
        api<EventLeader[]>("/administration/event-leaders")
      ]).then(([catalog, leaderRows]) => {
        setCampuses(catalog.campuses);
        setLeaders(leaderRows);
      });
  }, [event.id, session.role, serveMode]);
  const decide = async (id: string, decision: string) => {
    await api(`/assignments/${id}/decision`, { method: "PATCH", body: JSON.stringify({ decision }) });
    notify(`Assignment ${decision.toLowerCase()}.`);
    setRoster(await api(`/events/${event.id}/roster`));
  };
  const addTeam = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const result = await api<{ id: string }>(`/events/${event.id}/groups`, {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          instructions: data.instructions,
          leaderUserIds: [],
          requiredVolunteerCount: Number(data.requiredVolunteerCount),
          signupPolicy: data.signupPolicy,
          movementPolicy: data.movementPolicy,
          selfCheckinEnabled: data.selfCheckinEnabled === "on",
          isActive: true
        })
      });
      setTeams([
        ...teams,
        {
          id: result.id,
          event_id: event.id,
          name: String(data.name),
          description: String(data.description),
          instructions: String(data.instructions),
          leader_user_ids: [],
          required_count: Number(data.requiredVolunteerCount),
          confirmed_count: 0,
          open_count: Number(data.requiredVolunteerCount),
          pending_count: 0,
          signup_policy: data.signupPolicy as "AUTO" | "APPROVAL",
          movement_policy: data.movementPolicy as "AUTO" | "APPROVAL",
          self_checkin_enabled: data.selfCheckinEnabled === "on"
        }
      ]);
      setAddingTeam(false);
      notify("Event team added.");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const saveEvent = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    const data = Object.fromEntries(formData);
    try {
      await api(`/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          campusId: String(data.campusId),
          name: data.name,
          description: data.description,
          startsAt: new Date(String(data.startsAt)).toISOString(),
          endsAt: new Date(String(data.endsAt)).toISOString(),
          address: data.address,
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
          eventLeaderUserIds: formData.getAll("eventLeaderUserIds"),
          locationType: event.location_type ?? "CAMPUS",
          participatingCampusIds: event.participating_campus_ids?.length
            ? event.participating_campus_ids
            : [String(data.campusId)],
          status: data.status
        })
      });
      notify("Event updated.");
      saved();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={close}>
          <X />
        </button>
        <Breadcrumbs items={[{ label: breadcrumbLabel, onClick: close }, { label: event.name }]} />
        <span className="eyebrow">{event.campus_name}</span>
        <h2>{event.name}</h2>
        <p>{event.description}</p>
        {!serveMode && !editingEvent && hasRole(session, "ADMIN") && (
          <button className="secondary full" onClick={() => setEditingEvent(true)}>
            <Pencil size={16} /> Edit event
          </button>
        )}
        {editingEvent && (
          <form className="drawer-form" onSubmit={saveEvent}>
            <Field name="name" label="Event name" defaultValue={event.name} />
            <label>
              Description
              <textarea name="description" rows={3} defaultValue={event.description} required />
            </label>
            <label>
              Event status
              <select name="status" defaultValue={event.status}>
                {eventStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Campus
              <select
                name="campusId"
                value={editCampusId}
                required
                onChange={(changeEvent) => {
                  const campus = campuses.find((item) => item.id === changeEvent.target.value);
                  if (campus) useEditCampusLocation(campus);
                }}
              >
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="two-col">
              <DateTimeField name="startsAt" label="Starts" defaultValue={toDateTimeLocal(event.starts_at)} />
              <DateTimeField name="endsAt" label="Ends" defaultValue={toDateTimeLocal(event.ends_at)} />
            </div>
            <label>
              Address
              <input
                name="address"
                value={editLocation.address}
                required
                onChange={(changeEvent) => setEditLocation({ ...editLocation, address: changeEvent.target.value })}
              />
            </label>
            <div className="two-col">
              <LocationField
                name="latitude"
                label="Latitude"
                value={editLocation.latitude}
                onChange={(value) => setEditLocation({ ...editLocation, latitude: value })}
              />
              <LocationField
                name="longitude"
                label="Longitude"
                value={editLocation.longitude}
                onChange={(value) => setEditLocation({ ...editLocation, longitude: value })}
              />
            </div>
            <LeaderSelector leaders={leaders} selectedIds={event.event_leader_user_ids ?? []} />
            <button className="primary">Save event</button>
          </form>
        )}
        {!editingEvent && (
          <>
            <div className="detail-strip">
              <span>
                <CalendarDays />
                {formatDate(event.starts_at)}
              </span>
              <span>
                <MapPin />
                {event.address}
              </span>
            </div>
            <h3>{serveMode ? "Available event teams" : "Teams"}</h3>
            {serveMode ? (
              <div className="serve-team-grid">
                {teams.map((group) => {
                  const assignment = event.my_assignments?.find(
                    (item) =>
                      item.event_group_id === group.id && ["REQUESTED", "WAITLISTED", "CONFIRMED"].includes(item.status)
                  );
                  const staffingPercent = Math.min(
                    100,
                    (group.confirmed_count / Math.max(1, group.required_count)) * 100
                  );
                  return (
                    <article className="serve-team-card" key={group.id}>
                      <span className="ministry">Event team</span>
                      <strong>{group.name}</strong>
                      <p>{group.description || "No description has been added."}</p>
                      <div
                        className="my-task-staffing serve-team-staffing"
                        aria-label={`${group.confirmed_count} of ${group.required_count} positions filled`}
                      >
                        <span className="claim-count-badge">
                          <strong>
                            {group.confirmed_count}/{group.required_count}
                          </strong>
                          <small>filled</small>
                        </span>
                        <span className="my-task-progress" aria-hidden="true">
                          <i style={{ width: `${staffingPercent}%` }} />
                        </span>
                      </div>
                      {assignment ? (
                        <button className="secondary danger full" onClick={() => onWithdraw(event, assignment.id)}>
                          Withdraw
                        </button>
                      ) : (
                        <button
                          className="primary full"
                          disabled={!session.volunteerId && !hasRole(session, "ADMIN") && !proxyVolunteerId}
                          onClick={() => onSignup(event, group.id, proxyVolunteerId)}
                        >
                          Volunteer
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <>
                {hasRole(session, "ADMIN") && (
                  <button className="secondary full" onClick={() => setAddingTeam(!addingTeam)}>
                    <Plus size={16} /> Add event team
                  </button>
                )}
                {addingTeam && (
                  <form className="drawer-form" onSubmit={addTeam}>
                    <Field name="name" label="Team name" />
                    <label>
                      Description
                      <textarea name="description" rows={2} required />
                    </label>
                    <label>
                      Instructions
                      <textarea name="instructions" rows={2} />
                    </label>
                    <div className="two-col">
                      <Field name="requiredVolunteerCount" label="Volunteers required" type="number" />
                      <label>
                        Signup policy
                        <select name="signupPolicy" defaultValue="AUTO">
                          <option value="AUTO">Automatic confirmation</option>
                          <option value="APPROVAL">Leader approval</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Move/swap policy
                      <select name="movementPolicy" defaultValue="AUTO">
                        <option value="AUTO">Automatic confirmation</option>
                        <option value="APPROVAL">Leader approval</option>
                      </select>
                    </label>
                    <label className="check-label">
                      <input name="selfCheckinEnabled" type="checkbox" /> Enable location-bound self check-in
                    </label>
                    <button className="primary">Save event team</button>
                  </form>
                )}
                <div className="roster">
                  {roster.length ? (
                    roster.map((person) => (
                      <div key={person.assignment_id}>
                        <div className="avatar compact" aria-hidden="true">
                          {initials(personName(person.first_name, person.middle_name, person.last_name))}
                        </div>
                        <span>
                          <strong>{personName(person.first_name, person.middle_name, person.last_name)}</strong>
                          <small>
                            {person.event_group_name} · {person.status}
                          </small>
                        </span>
                        {person.status === "REQUESTED" && (
                          <div className="inline-actions">
                            <button onClick={() => decide(String(person.assignment_id), "CONFIRMED")}>
                              <Check size={16} />
                            </button>
                            <button onClick={() => decide(String(person.assignment_id), "REJECTED")}>
                              <X size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <Empty text="No volunteers are on this roster yet." />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function VolunteerDirectoryMaintenance({
  notify,
  close,
  parentLabel = "Administration"
}: {
  notify: (message: string) => void;
  close: () => void;
  parentLabel?: string;
}) {
  const [people, setPeople] = useState<VolunteerDirectoryPerson[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const debouncedSearch = useDebouncedValue(searchTerm);

  useEffect(() => {
    const controller = new AbortController();
    const query = debouncedSearch.trim();
    setSearching(true);
    api<VolunteerDirectoryPerson[]>(`/administration/volunteers${query ? `?q=${encodeURIComponent(query)}` : ""}`, {
      signal: controller.signal
    })
      .then(setPeople)
      .catch((error) => {
        if ((error as Error).name !== "AbortError") notify((error as Error).message);
      })
      .finally(() => setSearching(false));
    return () => controller.abort();
  }, [debouncedSearch, notify]);

  return (
    <>
      <Breadcrumbs items={[{ label: parentLabel, onClick: close }, { label: "Volunteer directory" }]} />
      <PageTitle
        eyebrow={parentLabel}
        title="Volunteer directory"
        description="Search volunteer profiles and review campus, access roles, ministries, and service activity."
      />
      <div className="maintenance-search volunteer-directory-search">
        <div className="search active">
          <Search size={17} />
          <label className="sr-only" htmlFor="volunteer-directory-search">
            Search volunteers
          </label>
          <input
            id="volunteer-directory-search"
            type="search"
            value={searchTerm}
            placeholder="Search name or email"
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          {searching && <span className="searching-indicator">Searching…</span>}
        </div>
        <div className="volunteer-search-markers" aria-label="Volunteer search markers">
          <span>
            <strong>:</strong> Role
          </span>
          <span>
            <strong>^</strong> Campus
          </span>
          <span>
            <strong>!</strong> Ministries
          </span>
        </div>
      </div>
      <Card
        title={`${people.length} volunteers`}
        action={
          <button className="secondary" onClick={() => downloadExport("volunteers")}>
            <Download size={16} /> Export
          </button>
        }
      >
        <div className="table volunteer-directory-list">
          {people.map((p) => (
            <div className="table-row volunteer-directory-row" key={p.volunteer_id}>
              <div className="avatar compact" aria-hidden="true">
                {initials(personName(p.first_name, p.middle_name, p.last_name))}
              </div>
              <span className="volunteer-directory-identity">
                <strong className="volunteer-directory-name">
                  {personName(p.first_name, p.middle_name, p.last_name)}
                  {p.application_status === "APPROVED" && (
                    <Check className="volunteer-approved-check" size={15} role="img" aria-label="Approved volunteer" />
                  )}
                </strong>
                <small>{p.email || "Managed dependent"}</small>
              </span>
              <span className="volunteer-directory-details">
                <small>
                  <Building2 size={14} /> {p.home_campus}
                </small>
                <small>
                  <ShieldCheck size={14} />
                  {p.roles.length ? p.roles.map(formatRoleName).join(", ") : "No access role"}
                </small>
                <small>
                  <Users size={14} /> {p.ministries.length ? p.ministries.join(", ") : "No ministries assigned"}
                </small>
              </span>
              {p.application_status !== "APPROVED" && (
                <span className={`status ${String(p.application_status).toLowerCase()}`}>{p.application_status}</span>
              )}
            </div>
          ))}
          {!people.length && !searching && (
            <Empty text={searchTerm ? "No volunteers match this search." : "No volunteers are available."} />
          )}
        </div>
      </Card>
    </>
  );
}

function Applications({
  notify,
  onApplicationsChanged
}: {
  notify: (m: string) => void;
  onApplicationsChanged?: () => void;
}) {
  const [items, setItems] = useState<Array<Record<string, string | number>>>([]);
  const load = () => api<Array<Record<string, string | number>>>("/applications").then(setItems);
  useEffect(() => {
    void load();
  }, []);
  const decide = async (id: string, status: string) => {
    await api(`/applications/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    notify(`Application ${status.toLowerCase()}.`);
    await load();
    onApplicationsChanged?.();
  };
  return (
    <>
      <PageTitle
        eyebrow="Registration"
        title="Volunteer applications"
        description="Review and welcome new people into serving."
      />
      <div className="application-grid">
        {items.map((p) => (
          <Card key={p.id} title={personName(p.first_name, p.middle_name, p.last_name)}>
            <p>{p.email}</p>
            <p className="meta">
              <Clock3 size={15} /> Status: {p.application_status}
            </p>
            <div className="card-actions">
              <button className="primary" onClick={() => decide(String(p.id), "APPROVED")}>
                <Check size={16} /> Approve
              </button>
              <button className="secondary danger" onClick={() => decide(String(p.id), "REJECTED")}>
                <X size={16} /> Reject
              </button>
            </div>
          </Card>
        ))}
      </div>
      {!items.length && <Empty text="No applications need review." />}
    </>
  );
}

function Broadcasts({ session, notify, close }: { session: Session; notify: (m: string) => void; close: () => void }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [eventId, setEventId] = useState("");
  const [eventGroupIds, setEventGroupIds] = useState<string[]>([]);
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [intendedRecipients, setIntendedRecipients] = useState("BOTH");
  const usesEventTargets = canManageEmailTemplates(session);
  const load = () => api<Array<Record<string, unknown>>>("/broadcasts").then(setItems);
  useEffect(() => {
    void load();
    Promise.all([api<EventItem[]>("/events"), api<EmailTemplate[]>("/tools/email-templates")])
      .then(([eventRows, templateRows]) => {
        setEvents(
          eventRows.filter((event) =>
            usesEventTargets
              ? hasRole(session, "ADMIN") || event.event_leader_user_ids.includes(session.id)
              : event.groups.some((group) => group.leader_user_ids.includes(session.id))
          )
        );
        setTemplates(templateRows.filter((template) => template.is_active));
      })
      .catch((error) => notify((error as Error).message));
  }, []);
  const selectedEvent = events.find((event) => event.id === eventId);
  const teamTargets = events.flatMap((event) =>
    event.groups
      .filter((group) => group.leader_user_ids.includes(session.id))
      .map((group) => ({ event, group, value: `${event.id}:${group.id}` }))
  );
  const selectedTeamTarget = eventId && eventGroupIds.length === 1 ? `${eventId}:${eventGroupIds[0]}` : "";
  const chooseTemplate = (id: string) => {
    setEmailTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (template) {
      setSubject(template.subject);
      setMessage(template.body);
    }
  };
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await api("/broadcasts", {
        method: "POST",
        body: JSON.stringify({
          eventId,
          eventGroupIds,
          emailTemplateId: emailTemplateId || null,
          intendedRecipients,
          subject,
          message,
          channels: ["PUSH", "EMAIL", "SMS"]
        })
      });
      notify("Broadcast queued for delivery.");
      setEventId("");
      setEventGroupIds([]);
      setEmailTemplateId("");
      setIntendedRecipients("BOTH");
      setSubject("");
      setMessage("");
      await load();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <>
      <Breadcrumbs items={[{ label: "Tools", onClick: close }, { label: "Broadcasts" }]} />
      <PageTitle
        eyebrow="Communication"
        title="Broadcast center"
        description="Send an event update to enlisted volunteers, people who have not enlisted yet, or both."
      />
      <div className="content-grid">
        <Card title="Create broadcast">
          <form onSubmit={send}>
            {usesEventTargets ? (
              <>
                <label>
                  Event
                  <select
                    value={eventId}
                    onChange={(event) => {
                      setEventId(event.target.value);
                      setEventGroupIds([]);
                    }}
                    required
                  >
                    <option value="">Select an event</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name} · {formatDate(event.starts_at)}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="broadcast-team-picker" disabled={!selectedEvent}>
                  <legend>
                    Event teams <small className="form-help">Optional · select one or more</small>
                  </legend>
                  <div className="broadcast-team-options">
                    <label
                      className={
                        eventGroupIds.length === 0 ? "broadcast-team-option selected" : "broadcast-team-option"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={eventGroupIds.length === 0}
                        onChange={() => setEventGroupIds([])}
                      />
                      <span>
                        <strong>All event teams</strong>
                        <small>Include every team in this event</small>
                      </span>
                    </label>
                    {selectedEvent?.groups.map((group) => {
                      const checked = eventGroupIds.includes(group.id);
                      return (
                        <label
                          key={group.id}
                          className={checked ? "broadcast-team-option selected" : "broadcast-team-option"}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setEventGroupIds((selected) =>
                                checked ? selected.filter((id) => id !== group.id) : [...selected, group.id]
                              )
                            }
                          />
                          <span>
                            <strong>{group.name}</strong>
                            <small>{group.confirmed_count} enlisted</small>
                          </span>
                        </label>
                      );
                    })}
                    {!selectedEvent && <p className="form-help">Select an event to view its teams.</p>}
                  </div>
                </fieldset>
              </>
            ) : (
              <label>
                Event team
                <select
                  value={selectedTeamTarget}
                  onChange={(event) => {
                    const [nextEventId, nextGroupId] = event.target.value.split(":");
                    setEventId(nextEventId || "");
                    setEventGroupIds(nextGroupId ? [nextGroupId] : []);
                  }}
                  required
                >
                  <option value="">Select an event team</option>
                  {teamTargets.map(({ event, group, value }) => (
                    <option key={value} value={value}>
                      {event.name} · {group.name} · {formatDate(event.starts_at)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Intended recipients
              <select value={intendedRecipients} onChange={(event) => setIntendedRecipients(event.target.value)}>
                <option value="ENLISTED">Volunteers Only</option>
                <option value="NOT_ENLISTED">Non-volunteers Only</option>
                <option value="BOTH">Both</option>
              </select>
              <small className="form-help">
                Volunteers are already enlisted for the selected event or teams. Non-volunteers have not enlisted yet.
              </small>
            </label>
            <label>
              Email template
              <select value={emailTemplateId} onChange={(event) => chooseTemplate(event.target.value)}>
                <option value="">None</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input value={subject} onChange={(event) => setSubject(event.target.value)} required />
            </label>
            <label>
              Message
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={7}
                required
                placeholder="Write a clear update for your volunteers..."
              />
            </label>
            <div className="channel-row">
              <span>
                <Check size={15} /> Push
              </span>
              <span>
                <Check size={15} /> Email
              </span>
              <span>
                <Check size={15} /> SMS
              </span>
            </div>
            <button className="primary full">
              <Megaphone size={16} /> Queue broadcast
            </button>
          </form>
        </Card>
        <Card title="Recent broadcasts">
          <div className="attention-list">
            {items.map((item) => (
              <Attention
                key={String(item.id)}
                icon={<Megaphone />}
                tone="blue"
                title={String(item.subject)}
                subtitle={`${item.event_name || "Event"} · ${item.email_template_name || "No template"}`}
              />
            ))}
            {!items.length && <Empty text="No broadcasts sent yet." />}
          </div>
        </Card>
      </div>
    </>
  );
}

function Reports() {
  const [report, setReport] = useState<Record<string, Array<Record<string, string | number>>>>({});
  useEffect(() => {
    api<Record<string, Array<Record<string, string | number>>>>("/reports/overview").then(setReport);
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="Insights"
        title="Reports and audit history"
        description="Understand staffing health, participation, compliance, and decisions."
      />
      <div className="report-grid">
        <Card title="Staffing by event">
          <div className="event-list">
            {report.staffing?.map((row, index) => (
              <div className="staff-row" key={index}>
                <span>
                  <strong>{row.event_name}</strong>
                  <small>
                    {row.filled} confirmed of {row.required} required
                  </small>
                </span>
                <div className="progress">
                  <i style={{ width: `${Math.min(100, (Number(row.filled) / Number(row.required)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Compliance status">
          <div className="big-number">
            {report.compliance?.reduce((sum, row) => sum + Number(row.count), 0) || 0}
            <small>active records</small>
          </div>
          <div className="export-row">
            <button onClick={() => downloadExport("events")}>
              <Download size={16} /> Events CSV
            </button>
          </div>
        </Card>
      </div>
      <Card title="Recent audit activity">
        <div className="audit-list">
          {report.recentAudit?.map((row) => (
            <div key={row.id}>
              <ShieldCheck size={16} />
              <span>
                <strong>{String(row.action).replaceAll("_", " ")}</strong>
                <small>
                  {row.actor_email} · {formatDate(String(row.created_at))}
                </small>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Tools({
  session,
  notify,
  launch,
  pendingMinistryRequests = 0,
  onMembershipRequestsChanged
}: {
  session: Session;
  notify: (message: string) => void;
  launch?: ToolsLaunch | null;
  pendingMinistryRequests?: number;
  onMembershipRequestsChanged?: () => void;
}) {
  const [section, setSection] = useState<ToolsSection>(launch?.section ?? "home");
  const [templateCount, setTemplateCount] = useState(0);
  const [eventTemplateCount, setEventTemplateCount] = useState(0);
  const [broadcastCount, setBroadcastCount] = useState(0);
  const [toolCounts, setToolCounts] = useState({
    volunteers: 0,
    tasks: 0,
    archivedEvents: 0
  });
  const canUseTemplates = canManageEmailTemplates(session);
  const canUseBroadcasts = canCreateBroadcasts(session);
  const canUseOperations = canUseNonVolunteerTools(session);
  const canUseArchivedEvents = canUseArchivedEventTools(session);
  const canRegisterForMinistry = Boolean(session.volunteerId);
  const canManageMinistryMembership = canManageMinistryMembershipTools(session);

  useEffect(() => {
    if (launch?.section) setSection(launch.section);
  }, [launch?.key, launch?.section]);

  useEffect(() => {
    if (section !== "home") return;
    if (canUseTemplates) {
      api<EmailTemplate[]>("/tools/email-templates")
        .then((templates) => {
          setTemplateCount(templates.length);
        })
        .catch(() => undefined);
      api<EventTemplate[]>("/tools/event-templates")
        .then((templates) => {
          setEventTemplateCount(templates.length);
        })
        .catch(() => undefined);
    }
    if (canUseBroadcasts) {
      api<Array<Record<string, unknown>>>("/broadcasts")
        .then((broadcasts) => {
          setBroadcastCount(broadcasts.length);
        })
        .catch(() => undefined);
    }
    if (canUseOperations || canUseArchivedEvents) {
      Promise.allSettled([
        canUseOperations ? api<VolunteerDirectoryPerson[]>("/administration/volunteers") : Promise.resolve([]),
        canUseOperations ? api<AdminTaskItem[]>("/administration/tasks") : Promise.resolve([]),
        canUseArchivedEvents ? api<ArchivedEvent[]>("/administration/archived-events") : Promise.resolve([])
      ]).then((results) => {
        const [volunteers, tasks, archivedEvents] = results.map((result) =>
          result.status === "fulfilled" ? result.value : []
        );
        setToolCounts({
          volunteers: volunteers.length,
          tasks: tasks.length,
          archivedEvents: archivedEvents.length
        });
      });
    }
  }, [section, canUseTemplates, canUseBroadcasts, canUseOperations, canUseArchivedEvents]);

  if (section === "volunteers" && canUseOperations) {
    return <VolunteerDirectoryMaintenance notify={notify} close={() => setSection("home")} parentLabel="Tools" />;
  }
  if (section === "tasks" && canUseOperations) {
    return <TaskAssignmentMaintenance notify={notify} close={() => setSection("home")} parentLabel="Tools" />;
  }
  if (section === "archived-events" && canUseArchivedEvents) {
    return <ArchivedEventMaintenance notify={notify} close={() => setSection("home")} parentLabel="Tools" />;
  }
  if (section === "email-templates" && canUseTemplates) {
    return <EmailTemplateManager notify={notify} close={() => setSection("home")} />;
  }
  if (section === "event-templates" && canUseTemplates) {
    return <EventTemplateManager notify={notify} close={() => setSection("home")} />;
  }
  if (section === "broadcasts" && canUseBroadcasts) {
    return <Broadcasts session={session} notify={notify} close={() => setSection("home")} />;
  }
  if (section === "ministry-registration" && canRegisterForMinistry) {
    return <MinistryRegistration notify={notify} close={() => setSection("home")} />;
  }
  if (section === "manage-ministry-membership" && canManageMinistryMembership) {
    return (
      <ManageMinistryMembership
        notify={notify}
        close={() => setSection("home")}
        onRequestsChanged={onMembershipRequestsChanged}
      />
    );
  }

  return (
    <>
      <PageTitle
        eyebrow="Leader tools"
        title="Tools"
        description="Create reusable resources, register for ministry service, and manage team membership."
      />
      <div className="maintenance-card-grid tools-card-grid">
        {canRegisterForMinistry && (
          <MaintenanceCard
            icon={<UserCheck />}
            title="Ministry Registration"
            description="Request membership in a ministry at a campus."
            onClick={() => setSection("ministry-registration")}
          />
        )}
        {canManageMinistryMembership && (
          <MaintenanceCard
            icon={<Users />}
            title="Manage Ministry Membership"
            description="Approve ministry requests and review members by campus."
            count={pendingMinistryRequests}
            onClick={() => setSection("manage-ministry-membership")}
          />
        )}
      </div>
      {(canUseOperations || canUseArchivedEvents) && (
        <>
          <div className="tools-section-divider">
            <span>Operations</span>
          </div>
          <div className="maintenance-card-grid tools-card-grid">
            {canUseOperations && (
              <MaintenanceCard
                icon={<Users />}
                title="Volunteer Directory"
                description="Search volunteers and review their home campus, access roles, ministries, and status."
                count={toolCounts.volunteers}
                onClick={() => setSection("volunteers")}
              />
            )}
            {canUseOperations && (
              <MaintenanceCard
                icon={<ClipboardList />}
                title="Assign Tasks"
                description="Assign operational tasks to volunteers serving with an active event team."
                count={toolCounts.tasks}
                onClick={() => setSection("tasks")}
              />
            )}
            {canUseArchivedEvents && (
              <MaintenanceCard
                icon={<CalendarDays />}
                title="Archived Events"
                description="Review completed, cancelled, and removed events or restore them to Active or Draft."
                count={toolCounts.archivedEvents}
                onClick={() => setSection("archived-events")}
              />
            )}
          </div>
        </>
      )}
      <div className="maintenance-card-grid tools-card-grid">
        {canUseBroadcasts && (
          <MaintenanceCard
            icon={<Megaphone />}
            title="Broadcasts"
            description="Send an event message using an optional email template and a targeted volunteer audience."
            count={broadcastCount}
            onClick={() => setSection("broadcasts")}
          />
        )}
      </div>
      {canUseTemplates && (
        <>
          <div className="tools-section-divider">
            <span>Templates</span>
          </div>
          <div className="maintenance-card-grid tools-card-grid">
            <MaintenanceCard
              icon={<Mail />}
              title="Email Templates"
              description="Build reusable email content with volunteer, event, team, campus, and leader variables."
              count={templateCount}
              onClick={() => setSection("email-templates")}
            />
            <MaintenanceCard
              icon={<CalendarDays />}
              title="Event Templates"
              description="Preconfigure event details and teams so future event schedules can be created in bulk."
              count={eventTemplateCount}
              onClick={() => setSection("event-templates")}
            />
          </div>
        </>
      )}
      {!canRegisterForMinistry &&
        !canManageMinistryMembership &&
        !canUseTemplates &&
        !canUseBroadcasts &&
        !canUseOperations &&
        !canUseArchivedEvents && <Empty text="No tools are available for your current role." />}
    </>
  );
}

function MinistryRegistration({ notify, close }: { notify: (message: string) => void; close: () => void }) {
  const [catalog, setCatalog] = useState<{ campuses: CampusCatalogItem[]; ministries: Ministry[] }>({
    campuses: [],
    ministries: []
  });
  const [requests, setRequests] = useState<MinistryMembershipRequest[]>([]);
  const [selectedCampusId, setSelectedCampusId] = useState("");
  const [selectedMinistryId, setSelectedMinistryId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api<{ campuses: CampusCatalogItem[]; ministries: Ministry[] }>("/catalog")
      .then((catalogRows) => {
        setCatalog(catalogRows);
      })
      .catch((error) => notify((error as Error).message));
    api<MinistryMembershipRequest[]>("/tools/ministry-membership/my-requests")
      .then(setRequests)
      .catch((error) => notify((error as Error).message));
  }, [notify]);

  useEffect(load, [load]);

  const blockedMinistryIdsForCampus = new Set(
    requests
      .filter((request) => request.status !== "CANCELLED" && request.campus_id === selectedCampusId)
      .map((request) => request.ministry_id)
  );
  const availableMinistries = catalog.ministries.filter(
    (ministry) => !selectedCampusId || !blockedMinistryIdsForCampus.has(ministry.id)
  );

  useEffect(() => {
    if (selectedMinistryId && !availableMinistries.some((ministry) => ministry.id === selectedMinistryId)) {
      setSelectedMinistryId("");
    }
  }, [availableMinistries, selectedMinistryId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const ministryId = selectedMinistryId;
    const campusId = selectedCampusId;
    if (!ministryId || !campusId) return notify("Select a ministry and campus.");
    setSubmitting(true);
    try {
      await api("/tools/ministry-membership/requests", {
        method: "POST",
        body: JSON.stringify({ ministryId, campusId })
      });
      notify("Ministry membership request submitted.");
      form.reset();
      setSelectedCampusId("");
      setSelectedMinistryId("");
      load();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Tools", onClick: close }, { label: "Ministry Registration" }]} />
      <PageTitle
        eyebrow="Ministry"
        title="Ministry Registration"
        description="Choose the ministry and campus where you would like to serve."
      />
      <form className="card campus-form" onSubmit={submit}>
        <MaintenanceFormTitle
          icon={<UserCheck />}
          title="Request membership"
          description="One request is allowed for each ministry and campus."
        />
        <label>
          Campus
          <select
            name="campusId"
            value={selectedCampusId}
            onChange={(event) => setSelectedCampusId(event.target.value)}
            required
          >
            <option value="">Select a campus</option>
            {catalog.campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>
                {campus.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ministry
          <select
            name="ministryId"
            value={selectedMinistryId}
            onChange={(event) => setSelectedMinistryId(event.target.value)}
            required
          >
            <option value="">
              {availableMinistries.length ? "Select a ministry" : "All ministries have been requested for this campus"}
            </option>
            {availableMinistries.map((ministry) => (
              <option key={ministry.id} value={ministry.id}>
                {ministry.name}
              </option>
            ))}
          </select>
          {!availableMinistries.length && (
            <small className="form-help">Select another campus to request this ministry in a different location.</small>
          )}
        </label>
        <div className="card-actions">
          <button
            className="primary"
            disabled={submitting || !selectedCampusId || !selectedMinistryId || !catalog.campuses.length}
          >
            {submitting ? "Submitting..." : "Submit request"}
          </button>
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
      <Card title="My ministry requests">
        {requests.length ? (
          <div className="table campus-table ministry-membership-list">
            {requests.map((request) => (
              <div className="table-row" key={request.id}>
                <span className="grow">
                  <strong>{request.ministry_name}</strong>
                  <small>
                    {request.campus_name} · {formatDate(request.requested_at)}
                  </small>
                  {request.decision_reason && <small>{request.decision_reason}</small>}
                </span>
                <span className="pill">{request.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No ministry requests have been submitted." />
        )}
      </Card>
    </>
  );
}

function ManageMinistryMembership({
  notify,
  close,
  onRequestsChanged
}: {
  notify: (message: string) => void;
  close: () => void;
  onRequestsChanged?: () => void;
}) {
  const [tab, setTab] = useState<"pending" | "members">("pending");
  const [scope, setScope] = useState<MinistryMembershipScope | null>(null);
  const [ministryFilter, setMinistryFilter] = useState("");
  const [campusFilter, setCampusFilter] = useState("");
  const [requests, setRequests] = useState<MinistryMembershipRequest[]>([]);
  const [members, setMembers] = useState<MinistryMember[]>([]);
  const [busyRequestId, setBusyRequestId] = useState("");
  const filtersInitialized = useRef(false);

  const loadScope = useCallback(() => {
    api<MinistryMembershipScope>("/tools/ministry-membership/scope")
      .then(setScope)
      .catch((error) => notify((error as Error).message));
  }, [notify]);

  const loadRequests = useCallback(() => {
    api<MinistryMembershipRequest[]>("/tools/ministry-membership/requests")
      .then(setRequests)
      .catch((error) => notify((error as Error).message));
  }, [notify]);

  const loadMembers = useCallback(() => {
    const params = new URLSearchParams();
    if (ministryFilter) params.set("ministryId", ministryFilter);
    if (campusFilter) params.set("campusId", campusFilter);
    const query = params.size ? `?${params.toString()}` : "";
    api<MinistryMember[]>(`/tools/ministry-membership/members${query}`)
      .then(setMembers)
      .catch((error) => notify((error as Error).message));
  }, [campusFilter, ministryFilter, notify]);

  useEffect(() => {
    if (tab === "members") loadScope();
  }, [loadScope, tab]);
  useEffect(loadRequests, [loadRequests]);
  useEffect(() => {
    if (tab === "members") loadMembers();
  }, [loadMembers, tab]);

  useEffect(() => {
    if (tab !== "members" || filtersInitialized.current) return;
    if (!scope && !members.length) return;
    filtersInitialized.current = true;
    const memberMinistryIds = [...new Set(members.map((member) => member.ministry_id))];
    const memberCampusIds = [
      ...new Set(members.map((member) => member.campus_id).filter((campusId): campusId is string => Boolean(campusId)))
    ];
    if (!scope) {
      setMinistryFilter(memberMinistryIds.length === 1 ? memberMinistryIds[0] : "");
      setCampusFilter(memberCampusIds.length === 1 ? memberCampusIds[0] : "");
      return;
    }
    const ledMinistryIds = [...new Set(scope.campusLeadScopes.map((lead) => lead.ministry_id))];
    const nextMinistryId =
      scope.ministries.length === 1
        ? scope.ministries[0]?.id
        : !scope.isAdmin && !scope.ministryHeadIds.length && ledMinistryIds.length === 1
          ? ledMinistryIds[0]
          : "";
    const ledCampusesForMinistry = nextMinistryId
      ? scope.campusLeadScopes.filter((lead) => lead.ministry_id === nextMinistryId)
      : scope.campusLeadScopes;
    const canManageAllCampusesForMinistry =
      Boolean(nextMinistryId) && (scope.isAdmin || scope.ministryHeadIds.includes(nextMinistryId));
    const nextCampusId =
      !canManageAllCampusesForMinistry && ledCampusesForMinistry.length === 1
        ? ledCampusesForMinistry[0]?.campus_id
        : "";
    setMinistryFilter(nextMinistryId ?? "");
    setCampusFilter(nextCampusId ?? "");
  }, [members, scope, tab]);

  const ministryOptions = (() => {
    const options = new Map<string, string>();
    scope?.ministries.forEach((ministry) => options.set(ministry.id, ministry.name));
    members.forEach((member) => options.set(member.ministry_id, member.ministry_name));
    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  })();

  const campusOptions = (() => {
    const memberCampusOptions = members
      .filter((member) => !ministryFilter || member.ministry_id === ministryFilter)
      .reduce((options, member) => {
        if (member.campus_id && member.campus_name) options.set(member.campus_id, member.campus_name);
        return options;
      }, new Map<string, string>());
    const mergeMemberCampuses = (campuses: Array<{ id: string; name: string }>) => {
      const options = new Map(campuses.map((campus) => [campus.id, campus.name]));
      memberCampusOptions.forEach((name, id) => options.set(id, name));
      return [...options.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name));
    };
    if (!scope) return mergeMemberCampuses([]);
    if (!ministryFilter) {
      if (scope.isAdmin || scope.ministryHeadIds.length) return mergeMemberCampuses(scope.campuses);
      const campusIds = new Set(scope.campusLeadScopes.map((lead) => lead.campus_id));
      return mergeMemberCampuses(scope.campuses.filter((campus) => campusIds.has(campus.id)));
    }
    if (scope.isAdmin || scope.ministryHeadIds.includes(ministryFilter)) return mergeMemberCampuses(scope.campuses);
    const campusIds = new Set(
      scope.campusLeadScopes.filter((lead) => lead.ministry_id === ministryFilter).map((lead) => lead.campus_id)
    );
    return mergeMemberCampuses(scope.campuses.filter((campus) => campusIds.has(campus.id)));
  })();

  useEffect(() => {
    if (campusFilter && !campusOptions.some((campus) => campus.id === campusFilter)) {
      setCampusFilter("");
    }
  }, [campusFilter, campusOptions]);

  const decide = async (requestId: string, decision: "APPROVED" | "DENIED") => {
    setBusyRequestId(requestId);
    try {
      await api(`/tools/ministry-membership/requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ decision })
      });
      notify(decision === "APPROVED" ? "Membership request approved." : "Membership request denied.");
      loadRequests();
      if (tab === "members") loadMembers();
      onRequestsChanged?.();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusyRequestId("");
    }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Tools", onClick: close }, { label: "Manage Ministry Membership" }]} />
      <PageTitle
        eyebrow="Ministry"
        title="Manage Ministry Membership"
        description="Review requests and inspect active ministry membership by campus."
      />
      <Card
        title="Ministry membership"
        action={
          <div className="location-filter" aria-label="Ministry membership tabs">
            <button type="button" className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>
              Pending
            </button>
            <button type="button" className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>
              Members
            </button>
          </div>
        }
      >
        {tab === "pending" ? (
          requests.length ? (
            <div className="table campus-table ministry-membership-list">
              {requests.map((request) => (
                <div className="table-row ministry-membership-row" key={request.id}>
                  <span className="grow">
                    <strong>{request.volunteer_name || request.user_name || request.user_email}</strong>
                    <small>
                      {request.ministry_name} · {request.campus_name}
                    </small>
                    <small>{request.user_email}</small>
                  </span>
                  <div className="campus-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={busyRequestId === request.id}
                      onClick={() => decide(request.id, "APPROVED")}
                    >
                      Approve
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busyRequestId === request.id}
                      onClick={() => decide(request.id, "DENIED")}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No pending ministry membership requests." />
          )
        ) : (
          <>
            <div className="filter-bar event-filter-bar ministry-member-filter">
              <label>
                Ministry
                <select value={ministryFilter} onChange={(event) => setMinistryFilter(event.target.value)}>
                  <option value="">All ministries</option>
                  {ministryOptions.map((ministry) => (
                    <option key={ministry.id} value={ministry.id}>
                      {ministry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Campus
                <select value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)}>
                  <option value="">All campuses</option>
                  {campusOptions.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {members.length ? (
              <div className="table campus-table ministry-membership-list">
                {members.map((member) => (
                  <div className="table-row" key={`${member.user_id}-${member.ministry_id}-${member.campus_id}`}>
                    <span className="grow">
                      <strong>{member.volunteer_name || member.user_name}</strong>
                      <small>
                        {member.ministry_name} · {member.campus_name || "Campus not assigned"}
                      </small>
                      <small>{member.user_email}</small>
                    </span>
                    <small>{formatDate(member.assigned_at)}</small>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No ministry members match this filter." />
            )}
          </>
        )}
      </Card>
    </>
  );
}

function CreateEventsPage({
  session,
  notify,
  close
}: {
  session: Session;
  notify: (message: string) => void;
  close: () => void;
}) {
  const [mode, setMode] = useState<"home" | "single" | "template">("home");
  const canUseTemplates = canManageEmailTemplates(session);

  if (mode === "single") {
    return (
      <OneOffEventCreator session={session} notify={notify} close={() => setMode("home")} parentLabel="Create Events" />
    );
  }
  if (mode === "template" && canUseTemplates) {
    return <TemplateEventCreator notify={notify} close={() => setMode("home")} parentLabel="Create Events" />;
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Events", onClick: close }, { label: "Create Events" }]} />
      <PageTitle
        eyebrow="Event"
        title="Create Events"
        description="Create one event from scratch or generate events from a reusable template."
      />
      <div className="maintenance-card-grid tools-card-grid">
        <MaintenanceCard
          icon={<MapPin />}
          title="Create Event"
          description="Create a single draft event and define its teams."
          onClick={() => setMode("single")}
        />
        {canUseTemplates && (
          <MaintenanceCard
            icon={<Plus />}
            title="Create Events Using Template"
            description="Generate one or more draft event instances and their teams from an event template."
            onClick={() => setMode("template")}
          />
        )}
      </div>
    </>
  );
}

function OneOffEventCreator({
  session,
  notify,
  close,
  parentLabel = "Tools",
  title = "Create Event"
}: {
  session: Session;
  notify: (message: string) => void;
  close: () => void;
  parentLabel?: string;
  title?: string;
}) {
  const [catalog, setCatalog] = useState<{ campuses: CampusCatalogItem[]; ministries: Ministry[] }>({
    campuses: [],
    ministries: []
  });
  const [eventLeaders, setEventLeaders] = useState<EventLeader[]>([]);
  const [teamLeaders, setTeamLeaders] = useState<EventLeader[]>([]);
  const [locationType, setLocationType] = useState<"CAMPUS" | "OFF_SITE">("CAMPUS");
  const [campusId, setCampusId] = useState("");
  const [participatingCampusIds, setParticipatingCampusIds] = useState<string[]>([]);
  const [location, setLocation] = useState({ address: "", latitude: "", longitude: "" });
  const [teams, setTeams] = useState<Array<EventTemplateTeam & { localId: string }>>([]);
  const [creating, setCreating] = useState(false);

  const newTeam = (): EventTemplateTeam & { localId: string } => ({
    localId:
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: "Open",
    description: "",
    instructions: "",
    leaderUserIds: [],
    requiredVolunteerCount: 0,
    signupPolicy: "AUTO",
    movementPolicy: "AUTO",
    selfCheckinEnabled: false
  });

  const useCampusLocation = (campus: CampusCatalogItem) => {
    setCampusId(campus.id);
    setLocation({
      address: campus.address ?? "",
      latitude: campus.latitude === null || campus.latitude === undefined ? "" : String(campus.latitude),
      longitude: campus.longitude === null || campus.longitude === undefined ? "" : String(campus.longitude)
    });
  };

  useEffect(() => {
    Promise.all([
      api<{ campuses: CampusCatalogItem[]; ministries: Ministry[] }>("/catalog"),
      api<{ eventLeaders: EventLeader[]; teamLeaders: EventLeader[] }>("/tools/event-template-leaders")
    ])
      .then(([catalogRows, leaderRows]) => {
        setCatalog(catalogRows);
        setEventLeaders(leaderRows.eventLeaders);
        setTeamLeaders(leaderRows.teamLeaders);
        if (catalogRows.campuses[0]) useCampusLocation(catalogRows.campuses[0]);
      })
      .catch((error) => notify((error as Error).message));
  }, []);

  const selectedParticipantDefaults =
    locationType === "CAMPUS" && campusId ? [campusId] : session.homeCampusIds.filter(Boolean);
  const selectedParticipantDefaultKey = selectedParticipantDefaults.join("|");
  useEffect(() => {
    setParticipatingCampusIds(selectedParticipantDefaults);
  }, [selectedParticipantDefaultKey]);
  const teamLeaderOptions = teamLeaders.filter((leader) => {
    if (!participatingCampusIds.length) return true;
    if (!leader.campus_ids?.length) return true;
    return leader.campus_ids.some((campusId) => participatingCampusIds.includes(campusId));
  });
  const teamLeaderOptionIds = teamLeaderOptions.map((leader) => leader.id).join("|");
  useEffect(() => {
    const allowedIds = new Set(teamLeaderOptions.map((leader) => leader.id));
    setTeams((current) =>
      current.map((team) => ({
        ...team,
        leaderUserIds: team.leaderUserIds.filter((leaderId) => allowedIds.has(leaderId))
      }))
    );
  }, [teamLeaderOptionIds]);
  const updateTeam = (index: number, patch: Partial<EventTemplateTeam>) => {
    setTeams((current) => current.map((team, teamIndex) => (teamIndex === index ? { ...team, ...patch } : team)));
  };
  const leaderName = (leader: EventLeader) => leader.display_name || leader.email;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const participatingCampusIds = formData.getAll("participatingCampusIds").map(String);
    if (!participatingCampusIds.length) return notify("Select at least one participating campus.");
    if (!location.latitude || !location.longitude) return notify("Latitude and longitude are required.");
    const anchorCampusId = locationType === "CAMPUS" ? campusId : participatingCampusIds[0];
    if (!anchorCampusId) return notify("Select a campus for this event.");
    const startsAt = new Date(String(formData.get("startsAt")));
    const endsAt = new Date(String(formData.get("endsAt")));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
      return notify("Enter a valid start date and end date.");
    if (endsAt <= startsAt) return notify("End date must be after start date.");
    const teamPayload = teams.map((team, index) => ({
      name: String(formData.get(`teamName-${index}`) ?? "").trim(),
      description: String(formData.get(`teamDescription-${index}`) ?? "").trim(),
      instructions: String(formData.get(`teamInstructions-${index}`) ?? "").trim(),
      leaderUserIds: formData.getAll(`teamLeaderUserIds-${index}`).map(String),
      requiredVolunteerCount: Number(formData.get(`teamRequiredVolunteerCount-${index}`) ?? 0),
      signupPolicy: String(formData.get(`teamSignupPolicy-${index}`)) as EventTemplateTeam["signupPolicy"],
      movementPolicy: String(formData.get(`teamMovementPolicy-${index}`)) as EventTemplateTeam["movementPolicy"],
      selfCheckinEnabled: formData.get(`teamSelfCheckinEnabled-${index}`) === "on"
    }));

    setCreating(true);
    try {
      await api("/events", {
        method: "POST",
        body: JSON.stringify({
          locationType,
          campusId: anchorCampusId,
          participatingCampusIds,
          name: String(formData.get("name") ?? ""),
          description: String(formData.get("description") ?? ""),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          address: location.address,
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          eventLeaderUserIds: formData.getAll("eventLeaderUserIds").map(String),
          teams: teamPayload
        })
      });
      notify("Event created as Draft.");
      close();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: parentLabel, onClick: close }, { label: title }]} />
      <PageTitle eyebrow="Event" title={title} />
      <form className="card template-event-create-form" onSubmit={submit}>
        <MaintenanceFormTitle
          icon={<MapPin />}
          title="Event details"
          description="Choose a physical location, then select the campuses and teams expected to participate."
        />
        <Field name="name" label="Event name" />
        <label>
          Description
          <textarea name="description" rows={3} required />
        </label>
        <div className="location-filter event-location-mode" aria-label="Event location type">
          <button
            type="button"
            className={locationType === "CAMPUS" ? "active" : ""}
            onClick={() => {
              setLocationType("CAMPUS");
              const campus = catalog.campuses.find((item) => item.id === campusId) ?? catalog.campuses[0];
              if (campus) useCampusLocation(campus);
            }}
          >
            Campus
          </button>
          <button
            type="button"
            className={locationType === "OFF_SITE" ? "active" : ""}
            onClick={() => {
              setLocationType("OFF_SITE");
              setLocation({ address: "", latitude: "", longitude: "" });
            }}
          >
            Off-site
          </button>
        </div>
        {locationType === "CAMPUS" && (
          <label>
            Event location
            <select
              value={campusId}
              required
              onChange={(event) => {
                const campus = catalog.campuses.find((item) => item.id === event.target.value);
                if (campus) useCampusLocation(campus);
              }}
            >
              <option value="">Select a campus</option>
              {catalog.campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Address
          <input
            value={location.address}
            required
            onChange={(event) => setLocation((value) => ({ ...value, address: event.target.value }))}
          />
        </label>
        <div className="two-col">
          <LocationField
            name="latitude"
            label="Latitude"
            value={location.latitude}
            disabled={locationType === "CAMPUS"}
            onChange={(value) => setLocation((current) => ({ ...current, latitude: value }))}
          />
          <LocationField
            name="longitude"
            label="Longitude"
            value={location.longitude}
            disabled={locationType === "CAMPUS"}
            onChange={(value) => setLocation((current) => ({ ...current, longitude: value }))}
          />
        </div>
        <CampusBubbleSelector
          key={`${locationType}-${campusId || selectedParticipantDefaults.join("-")}`}
          campuses={catalog.campuses}
          selectedIds={selectedParticipantDefaults}
          inputName="participatingCampusIds"
          title="Participating Campus"
          emptyLabel="Add participating campus"
          addAnotherLabel="Add another campus"
          helpText="Target volunteers from campuses close enough to participate in this one-off event."
          onChange={setParticipatingCampusIds}
        />
        <div className="two-col">
          <DateTimeField name="startsAt" label="Start date" />
          <DateTimeField name="endsAt" label="End date" />
        </div>
        <LeaderSelector leaders={eventLeaders} selectedIds={[session.id]} title="Event leader" />
        <section className="event-template-teams">
          <div className="card-header">
            <div>
              <span className="eyebrow">Event teams</span>
              <h3>{teams.length} configured</h3>
            </div>
          </div>
          <div className="event-template-team-list">
            {teams.map((team, index) => (
              <article className="event-template-team-card" key={team.localId}>
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Team {index + 1}</span>
                    <h3>{team.name || "Open"}</h3>
                  </div>
                  <button
                    className="secondary danger"
                    type="button"
                    onClick={() => setTeams((current) => current.filter((item) => item.localId !== team.localId))}
                  >
                    <X size={16} /> Remove
                  </button>
                </div>
                <label>
                  Ministry
                  <select
                    name={`teamName-${index}`}
                    value={team.name || "Open"}
                    onChange={(event) => updateTeam(index, { name: event.target.value })}
                    required
                  >
                    <option value="Open">Open</option>
                    {catalog.ministries.map((ministry) => (
                      <option key={ministry.id} value={ministry.name}>
                        {ministry.name}
                      </option>
                    ))}
                  </select>
                  <small className="form-help">Open allows any volunteer from a participating campus to join.</small>
                </label>
                <label>
                  Description
                  <textarea name={`teamDescription-${index}`} rows={2} defaultValue={team.description} required />
                </label>
                <label>
                  Instructions
                  <textarea name={`teamInstructions-${index}`} rows={2} defaultValue={team.instructions} />
                </label>
                <div className="two-col">
                  <Field
                    name={`teamRequiredVolunteerCount-${index}`}
                    label="Volunteers required"
                    type="number"
                    defaultValue={team.requiredVolunteerCount}
                  />
                  <label>
                    Signup policy
                    <select name={`teamSignupPolicy-${index}`} defaultValue={team.signupPolicy}>
                      <option value="AUTO">Automatic confirmation</option>
                      <option value="APPROVAL">Leader approval</option>
                    </select>
                  </label>
                </div>
                <div className="two-col">
                  <label>
                    Move/swap policy
                    <select name={`teamMovementPolicy-${index}`} defaultValue={team.movementPolicy}>
                      <option value="AUTO">Automatic confirmation</option>
                      <option value="APPROVAL">Leader approval</option>
                    </select>
                  </label>
                  <span />
                </div>
                <label>
                  Team leader
                  <select
                    name={`teamLeaderUserIds-${index}`}
                    value={team.leaderUserIds[0] ?? ""}
                    onChange={(event) =>
                      updateTeam(index, { leaderUserIds: event.target.value ? [event.target.value] : [] })
                    }
                  >
                    <option value="">Unassigned</option>
                    {teamLeaderOptions.map((leader) => (
                      <option key={leader.id} value={leader.id}>
                        {leaderName(leader)}
                      </option>
                    ))}
                  </select>
                  {!teamLeaderOptions.length && (
                    <small className="form-help">
                      No event leaders or team leaders match the participating campus.
                    </small>
                  )}
                </label>
                <label className="check-label">
                  <input
                    name={`teamSelfCheckinEnabled-${index}`}
                    type="checkbox"
                    defaultChecked={team.selfCheckinEnabled}
                  />
                  Enable location-bound self check-in
                </label>
              </article>
            ))}
            {!teams.length && <Empty text="No event teams have been added to this event." />}
          </div>
          <button
            className="secondary full"
            type="button"
            onClick={() => setTeams((current) => [...current, newTeam()])}
          >
            <Plus size={16} /> Add event team
          </button>
        </section>
        <div className="card-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </>
  );
}

const scheduleIntervals = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "EVERY_2_WEEKS", label: "Every 2 weeks" },
  { value: "EVERY_3_WEEKS", label: "Every 3 weeks" },
  { value: "EVERY_4_WEEKS", label: "Every 4 weeks" },
  { value: "EVERY_5_WEEKS", label: "Every 5 weeks" },
  { value: "EVERY_6_WEEKS", label: "Every 6 weeks" },
  { value: "EVERY_7_WEEKS", label: "Every 7 weeks" },
  { value: "EVERY_8_WEEKS", label: "Every 8 weeks" }
] as const;

function TemplateEventCreator({
  notify,
  close,
  parentLabel = "Tools"
}: {
  notify: (message: string) => void;
  close: () => void;
  parentLabel?: string;
}) {
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [catalog, setCatalog] = useState<{ campuses: CampusCatalogItem[] }>({ campuses: [] });
  const [eventLeaders, setEventLeaders] = useState<EventLeader[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [campusId, setCampusId] = useState("");
  const [location, setLocation] = useState({ address: "", latitude: "", longitude: "" });
  const [creating, setCreating] = useState(false);
  const selectedTemplate = templates.find((template) => template.id === templateId);

  useEffect(() => {
    Promise.all([
      api<EventTemplate[]>("/tools/event-templates"),
      api<{ campuses: CampusCatalogItem[] }>("/catalog"),
      api<{ eventLeaders: EventLeader[]; teamLeaders: EventLeader[] }>("/tools/event-template-leaders")
    ])
      .then(([templateRows, catalogRows, leaderRows]) => {
        setTemplates(templateRows.filter((template) => template.is_active));
        setCatalog(catalogRows);
        setEventLeaders(leaderRows.eventLeaders);
        if (catalogRows.campuses[0]) useCampusLocation(catalogRows.campuses[0]);
      })
      .catch((error) => notify((error as Error).message));
  }, []);

  const useCampusLocation = (campus: CampusCatalogItem) => {
    setCampusId(campus.id);
    setLocation({
      address: campus.address ?? "",
      latitude: campus.latitude === null || campus.latitude === undefined ? "" : String(campus.latitude),
      longitude: campus.longitude === null || campus.longitude === undefined ? "" : String(campus.longitude)
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!templateId) return notify("Select an event template.");
    if (!location.latitude || !location.longitude) return notify("Selected campus does not have derived coordinates.");
    const formData = new FormData(event.currentTarget);
    setCreating(true);
    try {
      const result = await api<{ createdCount: number }>(`/tools/event-templates/${templateId}/create-events`, {
        method: "POST",
        body: JSON.stringify({
          eventName: String(formData.get("eventName") ?? ""),
          description: String(formData.get("description") ?? ""),
          campusId,
          address: location.address,
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          startsAt: new Date(String(formData.get("startsAt"))).toISOString(),
          endsAt: new Date(String(formData.get("endsAt"))).toISOString(),
          occurrence: Number(formData.get("occurrence") ?? 1),
          interval: String(formData.get("interval") ?? "WEEKLY"),
          eventLeaderUserIds: formData.getAll("eventLeaderUserIds").map(String)
        })
      });
      notify(`${result.createdCount} event${result.createdCount === 1 ? "" : "s"} created as draft.`);
      close();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={[{ label: parentLabel, onClick: close }, { label: "Create Events Using Template" }]} />
      <PageTitle
        eyebrow="Scheduling"
        title="Create Events Using Template"
        description="Generate draft event instances and template teams across a recurring schedule."
      />
      <form key={templateId || "template-event-create"} className="card template-event-create-form" onSubmit={submit}>
        <MaintenanceFormTitle
          icon={<Plus />}
          title="Schedule from template"
          description="Each occurrence creates a draft event and copies the template's event teams."
        />
        <label>
          Event template
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
            <option value="">Select a template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.teams.length} team{template.teams.length === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <Field name="eventName" label="Event name" defaultValue={selectedTemplate?.name ?? ""} />
        <label>
          Description
          <textarea name="description" rows={3} defaultValue={selectedTemplate?.description ?? ""} required />
        </label>
        <div className="two-col">
          <label>
            Campus
            <select
              value={campusId}
              required
              onChange={(event) => {
                const campus = catalog.campuses.find((item) => item.id === event.target.value);
                if (campus) useCampusLocation(campus);
              }}
            >
              <option value="">Select a campus</option>
              {catalog.campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Address
            <input
              value={location.address}
              required
              onChange={(event) => setLocation((value) => ({ ...value, address: event.target.value }))}
            />
          </label>
        </div>
        <div className="two-col">
          <LocationField
            name="latitude"
            label="Latitude"
            value={location.latitude}
            disabled
            onChange={(value) => setLocation((current) => ({ ...current, latitude: value }))}
          />
          <LocationField
            name="longitude"
            label="Longitude"
            value={location.longitude}
            disabled
            onChange={(value) => setLocation((current) => ({ ...current, longitude: value }))}
          />
        </div>
        <div className="two-col">
          <DateTimeField name="startsAt" label="Start date" />
          <DateTimeField name="endsAt" label="End date" />
        </div>
        <div className="two-col">
          <label>
            Occurrence
            <input name="occurrence" type="number" min={1} max={24} defaultValue={1} required />
          </label>
          <label>
            Interval
            <select name="interval" defaultValue="WEEKLY">
              {scheduleIntervals.map((interval) => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <LeaderSelector
          key={`template-event-leaders-${templateId || "none"}`}
          leaders={eventLeaders}
          selectedIds={selectedTemplate?.event_leader_user_ids ?? []}
          title="Event leader"
        />
        <div className="card-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </>
  );
}

type EventTemplateForm = {
  name: string;
  description: string;
  isActive: boolean;
};

const blankEventTemplateForm: EventTemplateForm = {
  name: "",
  description: "",
  isActive: true
};

const blankEventTemplateTeam: EventTemplateTeam = {
  name: "Open",
  description: "",
  instructions: "",
  leaderUserIds: [],
  requiredVolunteerCount: 0,
  signupPolicy: "AUTO",
  movementPolicy: "AUTO",
  selfCheckinEnabled: false
};

function EventTemplateManager({ notify, close }: { notify: (message: string) => void; close: () => void }) {
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [selected, setSelected] = useState<EventTemplate | null>(null);
  const [form, setForm] = useState<EventTemplateForm>(blankEventTemplateForm);
  const [teams, setTeams] = useState<EventTemplateTeam[]>([]);
  const [templateTab, setTemplateTab] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [expandedTeamIndex, setExpandedTeamIndex] = useState(0);
  const loadTemplates = useCallback(
    () =>
      api<EventTemplate[]>("/tools/event-templates")
        .then(setTemplates)
        .catch((error) => notify((error as Error).message)),
    []
  );

  useEffect(() => {
    void loadTemplates();
    api<{ campuses: CampusCatalogItem[]; ministries: Ministry[] }>("/catalog")
      .then((catalog) => setMinistries(catalog.ministries))
      .catch((error) => notify((error as Error).message));
  }, []);

  const startNew = () => {
    setSelected(null);
    setForm({ ...blankEventTemplateForm });
    setTeams([]);
    setExpandedTeamIndex(0);
    setEditorOpen(true);
  };

  const chooseTemplate = (template: EventTemplate) => {
    setSelected(template);
    setForm({
      name: template.name,
      description: template.description ?? "",
      isActive: template.is_active
    });
    setTeams(template.teams);
    setExpandedTeamIndex(0);
    setEditorOpen(true);
  };

  const backToList = () => {
    setEditorOpen(false);
    setSelected(null);
    setForm({ ...blankEventTemplateForm });
    setTeams([]);
    setExpandedTeamIndex(0);
  };

  const updateTeam = (index: number, patch: Partial<EventTemplateTeam>) => {
    setTeams((current) => current.map((team, teamIndex) => (teamIndex === index ? { ...team, ...patch } : team)));
  };

  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (selected && !selected.can_edit) return;
    const formData = new FormData(formEvent.currentTarget);
    const teamPayload = teams.map((team, index) => ({
      name: String(formData.get(`teamName-${index}`) ?? "").trim(),
      description: String(formData.get(`teamDescription-${index}`) ?? "").trim(),
      instructions: String(formData.get(`teamInstructions-${index}`) ?? "").trim(),
      leaderUserIds: [],
      requiredVolunteerCount: Number(formData.get(`teamRequiredVolunteerCount-${index}`) ?? 0),
      signupPolicy: String(formData.get(`teamSignupPolicy-${index}`)) as EventTemplateTeam["signupPolicy"],
      movementPolicy: String(formData.get(`teamMovementPolicy-${index}`)) as EventTemplateTeam["movementPolicy"],
      selfCheckinEnabled: formData.get(`teamSelfCheckinEnabled-${index}`) === "on"
    }));
    setSaving(true);
    try {
      await api(selected ? `/tools/event-templates/${selected.id}` : "/tools/event-templates", {
        method: selected ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          eventLeaderUserIds: [],
          teams: teamPayload,
          isActive: form.isActive
        })
      });
      await loadTemplates();
      backToList();
      notify(selected ? "Event template updated." : "Event template created.");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const archiveTemplate = async () => {
    if (!selected || !selected.can_edit) return;
    if (!window.confirm("Archiving Event\n\nAre you sure?")) return;
    setSaving(true);
    try {
      await api(`/tools/event-templates/${selected.id}/archive`, { method: "PATCH" });
      await loadTemplates();
      setTemplateTab("ARCHIVED");
      backToList();
      notify("Event template archived.");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selected || !selected.can_edit) return;
    if (!window.confirm("Deleting Event\n\nAre you sure?")) return;
    setSaving(true);
    try {
      await api(`/tools/event-templates/${selected.id}`, { method: "DELETE" });
      await loadTemplates();
      backToList();
      notify("Event template deleted.");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const readOnly = Boolean(selected && !selected.can_edit);
  const activeTemplates = templates.filter((template) => template.is_active);
  const archivedTemplates = templates.filter((template) => !template.is_active);
  const displayedTemplates = templateTab === "ACTIVE" ? activeTemplates : archivedTemplates;

  return (
    <>
      <Breadcrumbs
        items={
          editorOpen
            ? [
                { label: "Tools", onClick: close },
                { label: "Event templates", onClick: backToList },
                { label: selected ? selected.name : "Create event template" }
              ]
            : [{ label: "Tools", onClick: close }, { label: "Event templates" }]
        }
      />
      <PageTitle
        eyebrow="Planning tools"
        title={editorOpen ? (selected ? "Edit Event Template" : "Create Event Template") : "Event Templates"}
        description={
          editorOpen
            ? "Define reusable event details and the teams that should be created with it."
            : "Preconfigure event details and teams for future bulk scheduling."
        }
      />
      <div className={editorOpen ? "template-form-page" : "email-template-layout event-template-layout"}>
        {!editorOpen && (
          <aside className="card email-template-list">
            <div className="card-header">
              <div>
                <span className="eyebrow">Template library</span>
                <h3>
                  {displayedTemplates.length} {templateTab === "ACTIVE" ? "active" : "archived"} template
                  {displayedTemplates.length === 1 ? "" : "s"}
                </h3>
              </div>
              <button className="secondary" type="button" onClick={startNew}>
                <Plus size={16} /> New
              </button>
            </div>
            <div className="location-filter template-tabs" aria-label="Event template status">
              <button
                type="button"
                className={templateTab === "ACTIVE" ? "active" : ""}
                onClick={() => setTemplateTab("ACTIVE")}
              >
                Active
              </button>
              <button
                type="button"
                className={templateTab === "ARCHIVED" ? "active" : ""}
                onClick={() => setTemplateTab("ARCHIVED")}
              >
                Archived
              </button>
            </div>
            <div className="email-template-list-items">
              {displayedTemplates.map((template) => (
                <button
                  key={template.id}
                  className={
                    selected?.id === template.id ? "email-template-list-item active" : "email-template-list-item"
                  }
                  onClick={() => chooseTemplate(template)}
                >
                  <span className="email-template-list-icon">
                    <CalendarDays size={17} />
                  </span>
                  <span className="grow">
                    <strong>{template.name}</strong>
                    <small>
                      {template.teams.length} team{template.teams.length === 1 ? "" : "s"}
                    </small>
                  </span>
                  {!template.is_active && <span className="status neutral">Archived</span>}
                  <ChevronRight size={17} />
                </button>
              ))}
              {!displayedTemplates.length && (
                <p className="empty-state">
                  {templateTab === "ACTIVE"
                    ? "No active event templates yet. Create the first one."
                    : "No archived event templates."}
                </p>
              )}
            </div>
          </aside>
        )}

        {editorOpen && (
          <form
            key={selected?.id ?? "new-event-template"}
            className="card email-template-editor event-template-editor"
            onSubmit={save}
          >
            <MaintenanceFormTitle
              icon={<CalendarDays />}
              title={selected ? selected.name : "Create event template"}
              description={
                readOnly
                  ? `Shared by ${selected?.creator_name}`
                  : "Define reusable event details and the teams that should be created with it."
              }
            />
            {readOnly && (
              <div className="template-readonly-note">
                This shared event template is read-only. Create a new template to customize it.
              </div>
            )}
            {!readOnly && selected && (
              <div className="template-form-actions">
                {selected.is_active && (
                  <button
                    className="icon-button template-action-button"
                    type="button"
                    disabled={saving}
                    aria-label="Archive template"
                    title="Archive template"
                    onClick={archiveTemplate}
                  >
                    <Archive size={17} />
                  </button>
                )}
                <button
                  className="icon-button template-action-button danger"
                  type="button"
                  disabled={saving}
                  aria-label="Delete template"
                  title="Delete template"
                  onClick={deleteTemplate}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            )}
            <label>
              Template name
              <input
                value={form.name}
                onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                disabled={readOnly}
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={form.description}
                onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
                disabled={readOnly}
                rows={3}
              />
            </label>
            <section className="event-template-teams">
              <div className="card-header">
                <div>
                  <span className="eyebrow">Event teams</span>
                  <h3>{teams.length} configured</h3>
                </div>
              </div>
              <div className="event-template-team-list">
                {teams.map((team, index) => (
                  <article
                    className={["event-template-team-card", expandedTeamIndex === index ? "expanded" : "collapsed"]
                      .filter(Boolean)
                      .join(" ")}
                    key={`${selected?.id ?? "new"}-${index}`}
                  >
                    <div className="card-header">
                      <button
                        className="event-template-team-toggle"
                        type="button"
                        aria-expanded={expandedTeamIndex === index}
                        onClick={() => setExpandedTeamIndex(index)}
                      >
                        <span className="eyebrow">Team {index + 1}</span>
                        <h3>{team.name || "New event team"}</h3>
                      </button>
                      {!readOnly && teams.length > 1 && (
                        <button
                          className="secondary danger"
                          type="button"
                          onClick={() => {
                            setTeams((current) => current.filter((_, teamIndex) => teamIndex !== index));
                            setExpandedTeamIndex((current) => {
                              if (current === index) return Math.max(0, index - 1);
                              if (current > index) return current - 1;
                              return current;
                            });
                          }}
                        >
                          <X size={16} /> Remove
                        </button>
                      )}
                    </div>
                    <div className="event-template-team-fields" hidden={expandedTeamIndex !== index}>
                      <label>
                        Ministry
                        <select
                          name={`teamName-${index}`}
                          value={team.name || "Open"}
                          onChange={(event) => updateTeam(index, { name: event.target.value })}
                          disabled={readOnly}
                          required
                        >
                          <option value="Open">Open</option>
                          {team.name &&
                            team.name !== "Open" &&
                            !ministries.some((ministry) => ministry.name === team.name) && (
                              <option value={team.name}>{team.name}</option>
                            )}
                          {ministries.map((ministry) => (
                            <option key={ministry.id} value={ministry.name}>
                              {ministry.name}
                            </option>
                          ))}
                        </select>
                        <small className="form-help">
                          Open allows any volunteer from a participating campus to join.
                        </small>
                      </label>
                      <label>
                        Description
                        <textarea name={`teamDescription-${index}`} rows={2} defaultValue={team.description} />
                      </label>
                      <label>
                        Instructions
                        <textarea name={`teamInstructions-${index}`} rows={2} defaultValue={team.instructions} />
                      </label>
                      <div className="two-col">
                        <label>
                          Volunteers required
                          <input
                            name={`teamRequiredVolunteerCount-${index}`}
                            type="number"
                            value={team.requiredVolunteerCount}
                            onChange={(event) =>
                              updateTeam(index, { requiredVolunteerCount: Number(event.target.value) })
                            }
                            required
                          />
                        </label>
                        <label>
                          Signup policy
                          <select
                            name={`teamSignupPolicy-${index}`}
                            defaultValue={team.signupPolicy}
                            onChange={(event) =>
                              updateTeam(index, {
                                signupPolicy: event.target.value as EventTemplateTeam["signupPolicy"]
                              })
                            }
                          >
                            <option value="AUTO">Automatic confirmation</option>
                            <option value="APPROVAL">Leader approval</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Move/swap policy
                        <select
                          name={`teamMovementPolicy-${index}`}
                          defaultValue={team.movementPolicy}
                          onChange={(event) =>
                            updateTeam(index, {
                              movementPolicy: event.target.value as EventTemplateTeam["movementPolicy"]
                            })
                          }
                        >
                          <option value="AUTO">Automatic confirmation</option>
                          <option value="APPROVAL">Leader approval</option>
                        </select>
                      </label>
                      <label className="check-label">
                        <input
                          name={`teamSelfCheckinEnabled-${index}`}
                          type="checkbox"
                          defaultChecked={team.selfCheckinEnabled}
                        />
                        Enable location-bound self check-in
                      </label>
                    </div>
                  </article>
                ))}
                {!teams.length && <Empty text="No event teams have been added to this template." />}
              </div>
              {!readOnly && (
                <button
                  className="secondary full"
                  type="button"
                  onClick={() => {
                    setTeams((current) => [...current, { ...blankEventTemplateTeam }]);
                    setExpandedTeamIndex(teams.length);
                  }}
                >
                  <Plus size={16} /> Add team
                </button>
              )}
            </section>

            {!readOnly && (
              <div className="email-template-actions">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) => setForm((value) => ({ ...value, isActive: event.target.checked }))}
                  />
                  Active template
                </label>
                <div className="card-actions template-save-actions">
                  <button className="primary" disabled={saving}>
                    {saving ? "Saving..." : selected ? "Save changes" : "Create template"}
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </>
  );
}

type EmailTemplateForm = {
  name: string;
  subject: string;
  body: string;
  isActive: boolean;
};

const blankEmailTemplate: EmailTemplateForm = {
  name: "",
  subject: "",
  body: "",
  isActive: true
};

function EmailTemplateManager({ notify, close }: { notify: (message: string) => void; close: () => void }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [variables, setVariables] = useState<EmailTemplateVariable[]>([]);
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [form, setForm] = useState<EmailTemplateForm>(blankEmailTemplate);
  const [saving, setSaving] = useState(false);
  const [lastField, setLastField] = useState<"subject" | "body">("body");
  const [editorOpen, setEditorOpen] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const loadTemplates = useCallback(
    () =>
      api<EmailTemplate[]>("/tools/email-templates")
        .then(setTemplates)
        .catch((error) => notify((error as Error).message)),
    []
  );

  useEffect(() => {
    void loadTemplates();
    api<EmailTemplateVariable[]>("/tools/email-template-variables")
      .then(setVariables)
      .catch((error) => notify((error as Error).message));
  }, []);

  const startNew = () => {
    setSelected(null);
    setForm({ ...blankEmailTemplate });
    setEditorOpen(true);
  };

  const chooseTemplate = (template: EmailTemplate) => {
    setSelected(template);
    setForm({
      name: template.name,
      subject: template.subject,
      body: template.body,
      isActive: template.is_active
    });
    setEditorOpen(true);
  };

  const backToList = () => {
    setEditorOpen(false);
    setSelected(null);
    setForm({ ...blankEmailTemplate });
  };

  const insertVariable = (token: string, field = lastField) => {
    if (selected && !selected.can_edit) return;
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    const current = form[field];
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    setForm((value) => ({ ...value, [field]: next }));
    setLastField(field);
    window.setTimeout(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const dropVariable = (event: ReactDragEvent<HTMLInputElement | HTMLTextAreaElement>, field: "subject" | "body") => {
    event.preventDefault();
    const token = event.dataTransfer.getData("text/plain");
    if (token) insertVariable(token, field);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selected && !selected.can_edit) return;
    setSaving(true);
    try {
      await api(selected ? `/tools/email-templates/${selected.id}` : "/tools/email-templates", {
        method: selected ? "PATCH" : "POST",
        body: JSON.stringify(form)
      });
      await loadTemplates();
      backToList();
      notify(selected ? "Email template updated" : "Email template created");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const preview = (content: string) =>
    variables.reduce((result, variable) => result.replaceAll(variable.token, variable.example), content);
  const readOnly = Boolean(selected && !selected.can_edit);

  return (
    <>
      <Breadcrumbs
        items={
          editorOpen
            ? [
                { label: "Tools", onClick: close },
                { label: "Email templates", onClick: backToList },
                { label: selected ? selected.name : "Create email template" }
              ]
            : [{ label: "Tools", onClick: close }, { label: "Email templates" }]
        }
      />
      <PageTitle
        eyebrow="Communication tools"
        title={editorOpen ? (selected ? "Edit Email Template" : "Create Email Template") : "Email Templates"}
        description={
          editorOpen
            ? "Write the subject, body, variables, and preview for this email template."
            : "Write once, then personalize every message with dynamic variables."
        }
      />
      <div className={editorOpen ? "template-form-page" : "email-template-layout"}>
        {!editorOpen && (
          <aside className="card email-template-list">
            <div className="card-header">
              <div>
                <span className="eyebrow">Template library</span>
                <h3>{templates.length} templates</h3>
              </div>
              <button className="secondary" type="button" onClick={startNew}>
                <Plus size={16} /> New
              </button>
            </div>
            <div className="email-template-list-items">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={
                    selected?.id === template.id ? "email-template-list-item active" : "email-template-list-item"
                  }
                  onClick={() => chooseTemplate(template)}
                >
                  <span className="email-template-list-icon">
                    <Mail size={17} />
                  </span>
                  <span className="grow">
                    <strong>{template.name}</strong>
                    <small>{template.can_edit ? "Editable" : `Shared by ${template.creator_name}`}</small>
                  </span>
                  {!template.is_active && <span className="status neutral">Inactive</span>}
                  <ChevronRight size={17} />
                </button>
              ))}
              {!templates.length && <p className="empty-state">No email templates yet. Create the first one.</p>}
            </div>
          </aside>
        )}

        {editorOpen && (
          <form className="card email-template-editor" onSubmit={save}>
            <MaintenanceFormTitle
              icon={<Mail />}
              title={selected ? selected.name : "Create email template"}
              description={
                readOnly ? `Shared by ${selected?.creator_name}` : "Drag variables into the subject or email body."
              }
            />
            {readOnly && (
              <div className="template-readonly-note">
                This shared template is read-only. Create a new template to customize it.
              </div>
            )}
            <label>
              Template name
              <input
                value={form.name}
                onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
                placeholder="Volunteer reminder"
                disabled={readOnly}
                required
              />
            </label>
            <label>
              Email subject
              <input
                ref={subjectRef}
                value={form.subject}
                onFocus={() => setLastField("subject")}
                onChange={(event) => setForm((value) => ({ ...value, subject: event.target.value }))}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropVariable(event, "subject")}
                placeholder="You're scheduled for {{event.name}}"
                disabled={readOnly}
                required
              />
            </label>
            <label>
              Email body
              <textarea
                ref={bodyRef}
                value={form.body}
                onFocus={() => setLastField("body")}
                onChange={(event) => setForm((value) => ({ ...value, body: event.target.value }))}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropVariable(event, "body")}
                rows={12}
                placeholder={
                  "Hi {{volunteer.first_name}},\n\nThank you for serving with {{team.name}} at {{event.name}}."
                }
                disabled={readOnly}
                required
              />
            </label>

            <div className="email-variable-panel">
              <div>
                <strong>Email variables</strong>
                <small>Drag a variable into a field, or click one to insert it at your cursor.</small>
              </div>
              <div className="email-variable-chips">
                {variables.map((variable) => (
                  <button
                    key={variable.token}
                    type="button"
                    className="email-variable-chip"
                    draggable={!readOnly}
                    disabled={readOnly}
                    title={variable.description}
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", variable.token)}
                    onClick={() => insertVariable(variable.token)}
                  >
                    <GripVertical size={14} />
                    <span>
                      <strong>{variable.label}</strong>
                      <small>{variable.token}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="email-template-preview">
              <span className="eyebrow">Live preview</span>
              <strong>{preview(form.subject) || "Your email subject will appear here"}</strong>
              <p>{preview(form.body) || "Your personalized email body will appear here."}</p>
            </div>
            {!readOnly && (
              <div className="email-template-actions">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) => setForm((value) => ({ ...value, isActive: event.target.checked }))}
                  />
                  Active template
                </label>
                <div className="card-actions">
                  <button className="secondary" type="button" onClick={startNew}>
                    Clear
                  </button>
                  <button className="primary" disabled={saving}>
                    {saving ? "Saving..." : selected ? "Save changes" : "Create template"}
                  </button>
                </div>
              </div>
            )}
          </form>
        )}
      </div>
    </>
  );
}

function Administration({
  session,
  navigate,
  notify
}: {
  session: Session;
  navigate: (view: View) => void;
  notify: (m: string) => void;
}) {
  const [section, setSection] = useState<
    "home" | "campuses" | "ministries" | "system-roles" | "role-assignments" | "audit"
  >("home");
  const [counts, setCounts] = useState({
    campuses: 0,
    ministries: 0,
    systemRoles: 0,
    assignments: 0,
    audit: 0
  });

  useEffect(() => {
    if (!hasRole(session, "ADMIN")) return;
    Promise.allSettled([
      api<Campus[]>("/administration/campuses"),
      api<Ministry[]>("/administration/ministries"),
      api<SystemRole[]>("/administration/system-roles"),
      api<UserRoleAssignment[]>("/administration/role-assignments"),
      api<AuditLogItem[]>("/administration/audit-logs")
    ]).then((results) => {
      const [campuses, ministries, systemRoles, assignments, audit] = results.map((result) =>
        result.status === "fulfilled" ? result.value : []
      );
      setCounts({
        campuses: campuses.length,
        ministries: ministries.length,
        systemRoles: systemRoles.length,
        assignments: assignments.length,
        audit: audit.length
      });
      const failed = results.find((result) => result.status === "rejected");
      if (failed) notify((failed.reason as Error).message);
    });
  }, []);

  if (!hasRole(session, "ADMIN"))
    return <MinistryMaintenance session={session} notify={notify} close={() => navigate("serve")} />;

  if (section === "campuses") return <CampusMaintenance notify={notify} close={() => setSection("home")} />;
  if (section === "ministries")
    return <MinistryMaintenance session={session} notify={notify} close={() => setSection("home")} />;
  if (section === "system-roles") return <SystemRoleMaintenance notify={notify} close={() => setSection("home")} />;
  if (section === "role-assignments")
    return <RoleAssignmentMaintenance notify={notify} close={() => setSection("home")} />;
  if (section === "audit") return <AuditLogMaintenance notify={notify} close={() => setSection("home")} />;

  return (
    <>
      <PageTitle
        eyebrow="Administration overview"
        title={`Welcome, ${session.name}`}
        description={`Here is what needs your attention across ${session.homeCampus}.`}
      />
      <Dashboard session={session} navigate={navigate} notify={notify} />
      <div className="administration-maintenance-heading">
        <span className="eyebrow">Configuration</span>
        <h2>Table maintenance</h2>
        <p>Manage the church structure and configuration used throughout VolunteerHub.</p>
      </div>
      <div className="maintenance-card-grid">
        <MaintenanceCard
          icon={<Building2 />}
          title="Campus"
          description="Maintain church locations, addresses, map coordinates, and active status."
          count={counts.campuses}
          onClick={() => setSection("campuses")}
        />
        <MaintenanceCard
          icon={<Users />}
          title="Ministry"
          description="Maintain ministries, ministry heads, and campus lead assignments."
          count={counts.ministries}
          onClick={() => setSection("ministries")}
        />
        <MaintenanceCard
          icon={<Settings />}
          title="System Roles"
          description="Maintain application access roles and their descriptions."
          count={counts.systemRoles}
          onClick={() => setSection("system-roles")}
        />
        <MaintenanceCard
          icon={<UserCheck />}
          title="Role Assignments"
          description="Assign one or more application roles to each user."
          count={counts.assignments}
          onClick={() => setSection("role-assignments")}
        />
        <MaintenanceCard
          icon={<ClipboardList />}
          title="Audit"
          description="Search activity logs for login, registration, creation, updates, volunteering, withdrawals, and messaging."
          count={counts.audit}
          onClick={() => setSection("audit")}
        />
      </div>
    </>
  );
}

function TaskAssignmentMaintenance({
  notify,
  close,
  parentLabel = "Administration"
}: {
  notify: (m: string) => void;
  close: () => void;
  parentLabel?: string;
}) {
  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [editingTask, setEditingTask] = useState<AdminTaskItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const load = () =>
    Promise.all([api<AdminTaskItem[]>("/administration/tasks"), api<EventItem[]>("/events")])
      .then(([taskRows, eventRows]) => {
        setTasks(taskRows);
        setEvents(eventRows.filter((event) => event.status === "ACTIVE"));
      })
      .catch((error) => notify((error as Error).message));
  useEffect(() => void load(), []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const result = await api<{ id?: string; recipientCount?: number }>(
        editingTask ? `/administration/tasks/${editingTask.id}` : "/tasks",
        {
          method: editingTask ? "PATCH" : "POST",
          body: JSON.stringify({
            eventGroupId: data.eventGroupId,
            title: data.title,
            description: data.description,
            location: data.location,
            requiredVolunteers: Number(data.requiredVolunteers),
            priority: data.priority
          })
        }
      );
      notify(editingTask ? "Task updated." : `Task assigned to ${result.recipientCount ?? 0} confirmed volunteers.`);
      form.reset();
      setEditingTask(null);
      setSelectedEventId("");
      setFormOpen(false);
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const openCreateForm = () => {
    setEditingTask(null);
    setSelectedEventId("");
    setFormOpen(true);
  };

  const openEditForm = (task: AdminTaskItem) => {
    setEditingTask(task);
    setSelectedEventId(task.event_id);
    setFormOpen(true);
  };

  const backToTaskList = () => {
    setEditingTask(null);
    setSelectedEventId("");
    setFormOpen(false);
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredTasks = tasks.filter(
    (task) =>
      !normalizedSearch ||
      [
        task.title,
        task.description,
        task.location,
        task.event_name,
        task.event_group_name,
        task.campus_name,
        task.priority,
        task.status,
        task.created_by
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch))
  );
  const selectedEvent = events.find((event) => event.id === selectedEventId);

  return (
    <>
      <Breadcrumbs
        items={
          formOpen
            ? [
                { label: parentLabel, onClick: close },
                { label: "Assign Tasks", onClick: backToTaskList },
                { label: editingTask ? "Edit task" : "Assign task" }
              ]
            : [{ label: parentLabel, onClick: close }, { label: "Assign Tasks" }]
        }
      />
      <PageTitle
        eyebrow={parentLabel}
        title={formOpen ? (editingTask ? "Edit Task" : "Assign Task") : "Assign Tasks"}
        description={
          formOpen
            ? editingTask
              ? "Correct this task before work begins."
              : "Confirmed volunteers on the selected team will receive this task."
            : "Create operational tasks for volunteers serving with an active event team."
        }
      />
      {formOpen ? (
        <form className="card campus-form campus-form-page" key={editingTask?.id ?? "new-task"} onSubmit={save}>
          <MaintenanceFormTitle
            icon={<ClipboardList size={19} />}
            title={editingTask ? "Edit task" : "Assign task"}
            description={
              editingTask
                ? "Correct this task before work begins."
                : "Confirmed volunteers on the selected team will receive this task."
            }
          />
          <label>
            Event
            <select value={selectedEventId} required onChange={(event) => setSelectedEventId(event.target.value)}>
              <option value="">Select an event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Event group
            <select
              name="eventGroupId"
              required
              defaultValue={selectedEventId === editingTask?.event_id ? editingTask.event_group_id : ""}
              key={`${selectedEventId}-${editingTask?.event_group_id ?? "new"}`}
              disabled={!selectedEvent}
            >
              <option value="">Select an event group</option>
              {selectedEvent?.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <Field name="title" label="Task title" defaultValue={editingTask?.title} />
          <label>
            Description
            <textarea name="description" rows={4} defaultValue={editingTask?.description} />
          </label>
          <OptionalField name="location" label="Location" defaultValue={editingTask?.location} />
          <div className="two-col">
            <Field
              name="requiredVolunteers"
              label="Required volunteers"
              type="number"
              defaultValue={editingTask?.required_volunteers ?? 1}
            />
            <label>
              Priority
              <select name="priority" defaultValue={editingTask?.priority ?? "NORMAL"}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
          </div>
          {!events.length && <small className="form-help">Create an active event team before assigning tasks.</small>}
          <div className="card-actions">
            <button className="primary" disabled={!events.length}>
              {editingTask ? "Save changes" : "Assign task"}
            </button>
            <button className="secondary" type="button" onClick={backToTaskList}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <Card
          title="Tasks"
          action={
            <button onClick={openCreateForm}>
              <Plus size={16} /> Assign task
            </button>
          }
        >
          <div className="maintenance-search">
            <div className="search active">
              <Search size={17} />
              <input
                type="search"
                value={searchTerm}
                placeholder="Search tasks"
                aria-label="Search tasks"
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <small>Newest tasks appear first</small>
          </div>
          <div className="table campus-table">
            {filteredTasks.map((task) => {
              const taskDate = new Date(task.starts_at);
              return (
                <div className="table-row task-admin-row" key={task.id}>
                  <span className="task-date">
                    <strong>{taskDate.getDate()}</strong>
                    <small>{taskDate.toLocaleString("en-US", { month: "short" })}</small>
                  </span>
                  <span className="grow">
                    <strong>{task.title}</strong>
                    <small>
                      {task.event_name} · {task.event_group_name} · {task.claimed_volunteers}/{task.required_volunteers}{" "}
                      claimed
                    </small>
                    <small>
                      Assigned {formatDate(task.created_at)}
                      {task.location ? ` · ${task.location}` : ""}
                    </small>
                  </span>
                  <span className={`status ${task.status.toLowerCase()}`}>{formatRoleName(task.status)}</span>
                  {["OPEN", "STAFFED"].includes(task.status) && (
                    <button className="secondary" onClick={() => openEditForm(task)}>
                      <Pencil size={15} /> Edit
                    </button>
                  )}
                </div>
              );
            })}
            {!filteredTasks.length && <Empty text="No tasks match your search." />}
          </div>
        </Card>
      )}
    </>
  );
}

function ArchivedEventMaintenance({
  notify,
  close,
  parentLabel = "Administration"
}: {
  notify: (m: string) => void;
  close: () => void;
  parentLabel?: string;
}) {
  const [events, setEvents] = useState<ArchivedEvent[]>([]);
  const [editing, setEditing] = useState<ArchivedEvent | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [pendingStatusChange, setPendingStatusChange] = useState<{ event: ArchivedEvent; status: EventStatus } | null>(
    null
  );
  const load = () =>
    api<ArchivedEvent[]>("/administration/archived-events")
      .then((rows) => {
        setEvents(rows);
        setEditing((current) => (current ? (rows.find((event) => event.id === current.id) ?? null) : null));
      })
      .catch((error) => notify((error as Error).message));
  useEffect(() => void load(), []);
  const changeStatus = async (event: ArchivedEvent, status: EventStatus) => {
    if (status === event.status) return false;
    try {
      await api(`/administration/events/${event.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      notify(`${event.name} status changed to ${eventStatuses.find((item) => item.value === status)?.label}.`);
      void load();
      return true;
    } catch (error) {
      notify((error as Error).message);
      return false;
    }
  };
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredEvents = events.filter(
    (event) =>
      event.id === editing?.id ||
      !normalizedSearch ||
      [event.name, event.description, event.campus_name, event.status, event.address, ...event.event_leaders]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch))
  );
  return (
    <>
      <Breadcrumbs items={[{ label: parentLabel, onClick: close }, { label: "Archived Events" }]} />
      <PageTitle
        eyebrow={parentLabel}
        title="Archived Events"
        description="Review and restore events archived within the last 18 months."
      />
      <Card title="Archived Events">
        <div className="maintenance-search">
          <div className="search active">
            <Search size={17} />
            <input
              type="search"
              value={searchTerm}
              placeholder="Search archived events"
              aria-label="Search archived events"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </div>
        <div className={editing ? "administration-grid" : ""}>
          <div className="table campus-table">
            {filteredEvents.map((event) => (
              <div className="table-row" key={event.id}>
                <span className="attention-icon amber">
                  <CalendarDays size={19} />
                </span>
                <span className="grow">
                  <strong>{event.name}</strong>
                  <small>
                    {event.campus_name} · {formatDateRange(event.starts_at, event.ends_at)}
                  </small>
                </span>
                <span className={`status ${event.status.toLowerCase()}`}>{formatRoleName(event.status)}</span>
                <div className="campus-actions">
                  <button className="secondary" onClick={() => setEditing(event)}>
                    <Pencil size={15} /> View
                  </button>
                </div>
              </div>
            ))}
            {!filteredEvents.length && <Empty text="No archived events match your search." />}
          </div>
          {editing && (
            <form className="campus-form" onSubmit={(event) => event.preventDefault()}>
              <MaintenanceFormTitle
                icon={<CalendarDays size={19} />}
                title={editing.name}
                description="Event details are read only. Only status can be changed."
              />
              <ReadOnlyField label="Event name" value={editing.name} />
              <label>
                Description
                <textarea value={editing.description || ""} rows={3} readOnly />
              </label>
              <ReadOnlyField label="Campus" value={editing.campus_name} />
              <div className="two-col">
                <ReadOnlyField label="Starts" value={formatDate(editing.starts_at)} />
                <ReadOnlyField label="Ends" value={formatDate(editing.ends_at)} />
              </div>
              <ReadOnlyField label="Address" value={editing.address} />
              <div className="two-col">
                <ReadOnlyField label="Latitude" value={editing.latitude} />
                <ReadOnlyField label="Longitude" value={editing.longitude} />
              </div>
              <ReadOnlyField label="Event leaders" value={editing.event_leaders.join(", ") || "None assigned"} />
              <label>
                Event status
                <select
                  value={editing.status}
                  onChange={(event) =>
                    setPendingStatusChange({ event: editing, status: event.target.value as EventStatus })
                  }
                >
                  {eventStatuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary full" type="button" onClick={() => setEditing(null)}>
                Close
              </button>
            </form>
          )}
        </div>
      </Card>
      {pendingStatusChange && (
        <div className="confirmation-backdrop" onClick={() => setPendingStatusChange(null)}>
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-confirmation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="confirmation-icon">
              <CalendarDays size={22} />
            </span>
            <div>
              <span className="eyebrow">Confirm status change</span>
              <h3 id="status-confirmation-title">Change event status?</h3>
              <p>
                Change <strong>{pendingStatusChange.event.name}</strong> from{" "}
                <strong>{formatRoleName(pendingStatusChange.event.status)}</strong> to{" "}
                <strong>{formatRoleName(pendingStatusChange.status)}</strong>?
              </p>
            </div>
            <div className="confirmation-actions">
              <button className="secondary" type="button" onClick={() => setPendingStatusChange(null)}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={async () => {
                  const pending = pendingStatusChange;
                  setPendingStatusChange(null);
                  await changeStatus(pending.event, pending.status);
                }}
              >
                Change status
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <label>
      {label}
      <input value={value} readOnly />
    </label>
  );
}

function CampusMaintenance({ notify, close }: { notify: (m: string) => void; close: () => void }) {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [editing, setEditing] = useState<Campus | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = () =>
    api<Campus[]>("/administration/campuses")
      .then(setCampuses)
      .catch((error) => notify((error as Error).message));

  useEffect(() => {
    void load();
  }, []);

  const payloadFor = (campus: Campus) => ({
    name: campus.name,
    addressLine1: campus.address_line_1,
    addressLine2: campus.address_line_2 || null,
    city: campus.city,
    region: campus.region,
    postalCode: campus.postal_code,
    countryCode: campus.country_code,
    latitude: campus.latitude === undefined || campus.latitude === null ? null : Number(campus.latitude),
    longitude: campus.longitude === undefined || campus.longitude === null ? null : Number(campus.longitude),
    timezone: campus.timezone,
    isActive: campus.is_active
  });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const numberOrNull = (value: unknown) => (String(value ?? "").trim() ? Number(value) : null);
    const body = {
      name: data.name,
      addressLine1: data.addressLine1,
      addressLine2: String(data.addressLine2 ?? "").trim() || null,
      city: data.city,
      region: data.region,
      postalCode: data.postalCode,
      countryCode: data.countryCode,
      latitude: numberOrNull(data.latitude),
      longitude: numberOrNull(data.longitude),
      timezone: data.timezone,
      isActive: data.isActive === "on"
    };
    try {
      await api(editing ? `/administration/campuses/${editing.id}` : "/administration/campuses", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      notify(editing ? "Campus updated." : "Campus created.");
      setEditing(null);
      setFormOpen(false);
      form.reset();
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const toggleActive = async (campus: Campus) => {
    try {
      await api(`/administration/campuses/${campus.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payloadFor(campus), isActive: !campus.is_active })
      });
      notify(`${campus.name} ${campus.is_active ? "deactivated" : "activated"}.`);
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const openForm = (campus?: Campus) => {
    setEditing(campus ?? null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
  };

  if (formOpen) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Administration", onClick: close },
            { label: "Campus Maintenance", onClick: closeForm },
            { label: editing ? "Edit Campus" : "Add Campus" }
          ]}
        />
        <PageTitle
          eyebrow="Administration"
          title={editing ? "Edit campus" : "Add campus"}
          description={editing ? "Update this location's details." : "Create a new church location."}
        />
        <Card title={editing ? "Campus details" : "New campus"}>
          <form className="campus-form campus-form-page" key={editing?.id ?? "new"} onSubmit={save}>
            <div className="campus-form-title">
              <span className="attention-icon teal">
                <Building2 size={19} />
              </span>
              <div>
                <strong>{editing ? "Edit campus" : "Add campus"}</strong>
                <small>{editing ? "Update this location's details." : "Create a new church location."}</small>
              </div>
            </div>
            <Field name="name" label="Campus name" defaultValue={editing?.name} />
            <Field name="addressLine1" label="Address line 1" defaultValue={editing?.address_line_1} />
            <OptionalField name="addressLine2" label="Address line 2" defaultValue={editing?.address_line_2} />
            <div className="two-col">
              <Field name="city" label="City" defaultValue={editing?.city} />
              <Field name="region" label="State / region" defaultValue={editing?.region} />
            </div>
            <div className="two-col">
              <Field name="postalCode" label="Postal code" defaultValue={editing?.postal_code} />
              <Field name="countryCode" label="Country code" defaultValue={editing?.country_code ?? "US"} />
            </div>
            <div className="two-col">
              <OptionalField name="latitude" label="Latitude" type="number" defaultValue={editing?.latitude} />
              <OptionalField name="longitude" label="Longitude" type="number" defaultValue={editing?.longitude} />
            </div>
            <Field name="timezone" label="Timezone" defaultValue={editing?.timezone ?? "America/Chicago"} />
            <label className="check-label">
              <input name="isActive" type="checkbox" defaultChecked={editing?.is_active ?? true} />
              Campus is active
            </label>
            <div className="card-actions">
              <button className="primary">{editing ? "Save changes" : "Create campus"}</button>
              <button className="secondary" type="button" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Administration", onClick: close }, { label: "Campus Maintenance" }]} />
      <PageTitle
        eyebrow="Administration"
        title="Campus maintenance"
        description="Maintain church locations, addresses, map coordinates, and active status."
      />
      <Card
        title="Campus"
        action={
          <button onClick={() => openForm()}>
            <Plus size={16} /> Add campus
          </button>
        }
      >
        <div className="table campus-table">
          {campuses.map((campus) => (
            <div className="table-row" key={campus.id}>
              <span className="attention-icon teal">
                <Building2 size={19} />
              </span>
              <span className="grow">
                <strong>{campus.name}</strong>
                <small>
                  {campus.address_line_1}, {campus.city}, {campus.region} {campus.postal_code}
                </small>
              </span>
              <div className="campus-row-controls">
                <span className={`status ${campus.is_active ? "approved" : "inactive"}`}>
                  {campus.is_active ? "Active" : "Inactive"}
                </span>
                <div className="campus-actions">
                  <button className="secondary" onClick={() => openForm(campus)}>
                    <Pencil size={15} /> Edit
                  </button>
                  <button className="secondary" onClick={() => toggleActive(campus)}>
                    {campus.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!campuses.length && <Empty text="No campuses have been configured." />}
        </div>
      </Card>
    </>
  );
}

function AuditLogMaintenance({ notify, close }: { notify: (m: string) => void; close: () => void }) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const load = useCallback(
    () =>
      api<AuditLogItem[]>(
        `/administration/audit-logs${submittedSearch.trim() ? `?q=${encodeURIComponent(submittedSearch.trim())}` : ""}`
      )
        .then(setLogs)
        .catch((error) => notify((error as Error).message)),
    [submittedSearch, notify]
  );
  useEffect(() => void load(), [load]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Administration", onClick: close }, { label: "Audit" }]} />
      <PageTitle
        eyebrow="Administration"
        title="Audit"
        description="Review login, registration, creation, updates, volunteering, withdrawals, and other activity."
      />
      <section className="card audit-card">
        <div className="card-header">
          <h3>Audit Log</h3>
        </div>
        <form
          className="maintenance-search audit-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(searchTerm);
          }}
        >
          <div className="search active">
            <Search size={17} />
            <input
              type="search"
              value={searchTerm}
              placeholder="Search audit logs or user: Mouse"
              aria-label="Search audit logs"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <button className="primary" type="submit">
            <Search size={16} /> Search
          </button>
        </form>
        <div className="audit-table-wrap">
          <table className="audit-log-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Action</th>
                <th>Module</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.occurred_at)}</td>
                  <td>
                    <strong>{log.actor_name}</strong>
                    {log.actor_email && <small>{log.actor_email}</small>}
                  </td>
                  <td>{formatAuditAction(log.action)}</td>
                  <td>
                    <span className="status neutral">{log.module}</span>
                  </td>
                  <td>
                    <strong>{log.entity_name || formatRoleName(log.entity_type)}</strong>
                    {log.entity_id && <small>{log.entity_id}</small>}
                  </td>
                  <td>{auditDetailsSummary(log.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logs.length && <Empty text="No audit log entries match your search." />}
        </div>
      </section>
    </>
  );
}

function MinistryMaintenance({
  session,
  notify,
  close
}: {
  session: Session;
  notify: (m: string) => void;
  close: () => void;
}) {
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [campuses, setCampuses] = useState<CampusCatalogItem[]>([]);
  const [ministryHeads, setMinistryHeads] = useState<EventLeader[]>([]);
  const [campusLeads, setCampusLeads] = useState<EventLeader[]>([]);
  const [editing, setEditing] = useState<Ministry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const canCreate = hasRole(session, "ADMIN");

  const load = () =>
    Promise.all([
      api<Ministry[]>("/administration/ministries"),
      canCreate
        ? api<Campus[]>("/administration/campuses").then((rows) =>
            rows.map((campus) => ({
              id: campus.id,
              name: campus.name,
              address: [campus.address_line_1, campus.city, campus.region, campus.postal_code]
                .filter(Boolean)
                .join(", "),
              latitude: Number(campus.latitude ?? 0),
              longitude: Number(campus.longitude ?? 0)
            }))
          )
        : api<{ campuses: CampusCatalogItem[] }>("/catalog").then((catalog) => catalog.campuses),
      api<{ ministryHeads: EventLeader[]; campusLeads: EventLeader[] }>("/administration/ministry-leader-candidates")
    ])
      .then(([ministryRows, campusRows, leaderRows]) => {
        setMinistries(ministryRows);
        setCampuses(campusRows);
        setMinistryHeads(leaderRows.ministryHeads);
        setCampusLeads(leaderRows.campusLeads);
      })
      .catch((error) => notify((error as Error).message));

  useEffect(() => {
    void load();
  }, []);

  const payloadFor = (ministry: Ministry) => ({
    name: ministry.name,
    description: ministry.description || null,
    ministryHeadUserId: ministry.ministry_head_user_id || null,
    campusLeads: (ministry.campus_leads ?? []).map((lead) => ({
      campusId: lead.campus_id,
      leadUserId: lead.lead_user_id || null
    })),
    isActive: ministry.is_active
  });

  const leaderLabel = (leader: EventLeader) => leader.display_name || leader.email;
  const campusLeadsFor = (ministry?: Ministry | null) =>
    campuses.map((campus) => {
      const lead = ministry?.campus_leads?.find((item) => item.campus_id === campus.id);
      return {
        campusId: campus.id,
        campusName: campus.name,
        leadUserId: lead?.lead_user_id ?? ""
      };
    });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    const body = {
      name: data.name,
      description: String(data.description ?? "").trim() || null,
      ministryHeadUserId: String(data.ministryHeadUserId ?? "").trim() || null,
      campusLeads: campuses.map((campus) => ({
        campusId: campus.id,
        leadUserId: String(formData.get(`campusLead-${campus.id}`) ?? "").trim() || null
      })),
      isActive: data.isActive === "on"
    };
    try {
      await api(editing ? `/administration/ministries/${editing.id}` : "/administration/ministries", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      notify(editing ? "Ministry updated." : "Ministry created.");
      setEditing(null);
      setFormOpen(false);
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const toggleActive = async (ministry: Ministry) => {
    try {
      await api(`/administration/ministries/${ministry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payloadFor(ministry), isActive: !ministry.is_active })
      });
      notify(`${ministry.name} ${ministry.is_active ? "deactivated" : "activated"}.`);
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  const sortedMinistries = [...ministries].sort((left, right) => left.name.localeCompare(right.name));

  if (formOpen) {
    const closeForm = () => {
      setEditing(null);
      setFormOpen(false);
    };
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Administration", onClick: close },
            { label: "Ministry", onClick: closeForm },
            { label: editing ? "Edit Ministry" : "Add Ministry" }
          ]}
        />
        <PageTitle
          eyebrow="Administration"
          title={editing ? "Edit ministry" : "Add ministry"}
          description={editing ? "Update this ministry's details and leaders." : "Create a ministry."}
        />
        <Card title={editing ? "Ministry details" : "New ministry"}>
          <form className="campus-form campus-form-page" key={editing?.id ?? "new"} onSubmit={save}>
            <MaintenanceFormTitle
              icon={<Users size={19} />}
              title={editing ? "Edit ministry" : "Add ministry"}
              description={editing ? "Update this ministry's details and leaders." : "Create a ministry."}
            />
            <Field name="name" label="Ministry name" defaultValue={editing?.name} />
            <label>
              Description
              <textarea name="description" rows={4} defaultValue={editing?.description} />
            </label>
            <label>
              Ministry Head
              <select name="ministryHeadUserId" defaultValue={editing?.ministry_head_user_id ?? ""}>
                <option value="">Unassigned</option>
                {ministryHeads.map((leader) => (
                  <option key={leader.id} value={leader.id}>
                    {leaderLabel(leader)}
                  </option>
                ))}
              </select>
            </label>
            <div className="campus-lead-list">
              <span className="leader-selector-title">Campus leads</span>
              {campusLeadsFor(editing).map((lead) => (
                <label className="campus-lead-row" key={lead.campusId}>
                  <span>
                    <Building2 size={15} />
                    {lead.campusName}
                  </span>
                  <select name={`campusLead-${lead.campusId}`} defaultValue={lead.leadUserId}>
                    <option value="">Unassigned</option>
                    {campusLeads.map((leader) => (
                      <option key={leader.id} value={leader.id}>
                        {leaderLabel(leader)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {!campuses.length && <small className="form-help">Create campuses before assigning campus leads.</small>}
            </div>
            <ActiveCheckbox label="Ministry is active" checked={editing?.is_active ?? true} />
            <MaintenanceFormActions editing={Boolean(editing)} cancel={closeForm} />
          </form>
        </Card>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Administration", onClick: close }, { label: "Ministry" }]} />
      <PageTitle
        eyebrow="Administration"
        title="Ministry maintenance"
        description="Maintain ministries, ministry heads, and campus lead assignments."
      />
      <Card
        title="Ministry"
        action={
          canCreate && (
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={16} /> Add ministry
            </button>
          )
        }
      >
        <div className="table campus-table">
          {sortedMinistries.map((ministry) => {
            const leadCount = (ministry.campus_leads ?? []).filter((lead) => lead.lead_user_id).length;
            return (
              <div className="table-row" key={ministry.id}>
                <span className="attention-icon blue">
                  <Users size={19} />
                </span>
                <span className="grow">
                  <strong>{ministry.name}</strong>
                  <small>{ministry.description || "No description"}</small>
                  <small>
                    Ministry Head: {ministry.ministry_head_name || "Unassigned"} · Campus leads: {leadCount}/
                    {campuses.length}
                  </small>
                </span>
                <span className={`status ${ministry.is_active ? "approved" : "inactive"}`}>
                  {ministry.is_active ? "Active" : "Inactive"}
                </span>
                <div className="campus-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(ministry);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil size={15} /> Edit
                  </button>
                  <button className="secondary" onClick={() => void toggleActive(ministry)}>
                    {ministry.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            );
          })}
          {!ministries.length && <Empty text="No ministries have been configured." />}
        </div>
      </Card>
    </>
  );
}

function SystemRoleMaintenance({ notify, close }: { notify: (m: string) => void; close: () => void }) {
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [editing, setEditing] = useState<SystemRole | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const load = () =>
    api<SystemRole[]>("/administration/system-roles")
      .then(setRoles)
      .catch((error) => notify((error as Error).message));
  useEffect(() => void load(), []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      code: String(data.code).trim().toUpperCase().replaceAll(" ", "_"),
      name: data.name,
      description: String(data.description ?? "").trim() || null,
      isActive: data.isActive === "on"
    };
    try {
      await api(editing ? `/administration/system-roles/${editing.code}` : "/administration/system-roles", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      notify(editing ? "System role updated." : "System role created.");
      setEditing(null);
      setFormOpen(false);
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  if (formOpen) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Administration", onClick: close },
            { label: "System Roles", onClick: () => setFormOpen(false) },
            { label: editing ? "Edit System Role" : "Add System Role" }
          ]}
        />
        <PageTitle
          eyebrow="Administration"
          title={editing ? "Edit system role" : "Add system role"}
          description={
            editing
              ? "Update this application role's display details."
              : "Create an application role that can be assigned to users."
          }
        />
        <Card title={editing ? "System role details" : "New system role"}>
          <form className="campus-form campus-form-page" key={editing?.code ?? "new"} onSubmit={save}>
            <MaintenanceFormTitle
              icon={<Settings size={19} />}
              title={editing ? "Edit system role" : "Add system role"}
              description="Role codes are permanent identifiers used by authorization rules."
            />
            {editing ? (
              <label>
                Role code
                <input value={editing.code} disabled />
              </label>
            ) : (
              <Field name="code" label="Role code" />
            )}
            <Field name="name" label="Display name" defaultValue={editing?.name} />
            <label>
              Description
              <textarea name="description" rows={4} defaultValue={editing?.description} />
            </label>
            <ActiveCheckbox label="Role is active" checked={editing?.is_active ?? true} />
            <MaintenanceFormActions
              editing={Boolean(editing)}
              cancel={() => {
                setEditing(null);
                setFormOpen(false);
              }}
            />
          </form>
        </Card>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Administration", onClick: close }, { label: "System Roles" }]} />
      <PageTitle
        eyebrow="Administration"
        title="System role maintenance"
        description="Maintain the application roles that can be assigned to users."
      />
      <Card
        title="System Roles"
        action={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={16} /> Add system role
          </button>
        }
      >
        <div className="table campus-table">
          {roles.map((role) => (
            <div className="table-row" key={role.code}>
              <span className="attention-icon amber">
                <Settings size={19} />
              </span>
              <span className="grow">
                <strong>{role.name}</strong>
                <small>
                  {role.code} · {role.assignment_count} assignments · {role.description || "No description"}
                </small>
              </span>
              <span className={`status ${role.is_active ? "approved" : "inactive"}`}>
                {role.is_active ? "Active" : "Inactive"}
              </span>
              <button
                className="secondary"
                onClick={() => {
                  setEditing(role);
                  setFormOpen(true);
                }}
              >
                <Pencil size={15} /> Edit
              </button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function RoleAssignmentMaintenance({ notify, close }: { notify: (m: string) => void; close: () => void }) {
  const [users, setUsers] = useState<UserRoleAssignment[]>([]);
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [editing, setEditing] = useState<UserRoleAssignment | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const load = () =>
    Promise.all([
      api<UserRoleAssignment[]>("/administration/role-assignments"),
      api<SystemRole[]>("/administration/system-roles")
    ])
      .then(([userRows, roleRows]) => {
        setUsers(userRows);
        setRoles(roleRows);
      })
      .catch((error) => notify((error as Error).message));
  useEffect(() => void load(), []);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const roleSearch = normalizedSearch.startsWith(":");
  const rolePrefix = normalizedSearch.slice(1);
  const filteredUsers = users.filter(
    (user) =>
      user.id === editing?.id ||
      !normalizedSearch ||
      (roleSearch
        ? user.roles.some((role) => {
            const roleName = roles.find((item) => item.code === role)?.name ?? formatRoleName(role);
            return [role, roleName].some((value) => value.toLowerCase().startsWith(rolePrefix));
          })
        : [user.display_name, user.email, user.status, ...user.roles]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedSearch)))
  );

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const selectedRoles = new FormData(event.currentTarget).getAll("roles");
    try {
      await api(`/administration/role-assignments/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({ roles: selectedRoles })
      });
      notify("Role assignments updated.");
      setEditing(null);
      void load();
    } catch (error) {
      notify((error as Error).message);
    }
  };

  if (editing) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Administration", onClick: close },
            { label: "Role Assignments", onClick: () => setEditing(null) },
            { label: editing.display_name || editing.email }
          ]}
        />
        <PageTitle
          eyebrow="Administration"
          title="Assign roles"
          description="Select every application role this user should hold."
        />
        <Card title="User roles">
          <form className="campus-form campus-form-page" key={editing.id} onSubmit={save}>
            <MaintenanceFormTitle
              icon={<UserCheck size={19} />}
              title={editing.display_name || editing.email}
              description={`${editing.email} · ${editing.status}`}
            />
            <div className="role-assignment-options">
              {roles
                .filter((role) => role.is_active || editing.roles.includes(role.code))
                .map((role) => (
                  <label className="check-label" key={role.code}>
                    <input
                      name="roles"
                      type="checkbox"
                      value={role.code}
                      defaultChecked={editing.roles.includes(role.code)}
                    />
                    <span>
                      <strong>{role.name}</strong>
                      <small>{role.description || role.code}</small>
                    </span>
                  </label>
                ))}
            </div>
            <MaintenanceFormActions editing cancel={() => setEditing(null)} />
          </form>
        </Card>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Administration", onClick: close }, { label: "Role Assignments" }]} />
      <PageTitle
        eyebrow="Administration"
        title="Role assignment maintenance"
        description="Assign one or more application roles to each user."
      />
      <Card title="Role Assignments">
        <div className="maintenance-search">
          <div className="search active">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search role assignments"
              value={searchTerm}
              placeholder="Search by name, email, status, or role"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <small>
            Showing {filteredUsers.length} of {users.length} users
          </small>
        </div>
        <div className="table campus-table">
          {filteredUsers.map((user) => (
            <div className="table-row" key={user.id}>
              <span className="attention-icon blue">
                <UserCheck size={19} />
              </span>
              <span className="grow">
                <strong>{user.display_name || user.email}</strong>
                <small>
                  {user.email} · {user.roles.join(", ") || "No roles"}
                </small>
              </span>
              <span className={`status ${user.status === "ACTIVE" ? "approved" : "inactive"}`}>{user.status}</span>
              <button className="secondary" onClick={() => setEditing(user)}>
                <Pencil size={15} /> Assign roles
              </button>
            </div>
          ))}
          {!filteredUsers.length && <Empty text="No users match your search." />}
        </div>
      </Card>
    </>
  );
}

function Profile({ notify }: { notify: (m: string) => void }) {
  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [campuses, setCampuses] = useState<CampusCatalogItem[]>([]);
  const [ministries, setMinistries] = useState<Ministry[]>([]);
  const [editing, setEditing] = useState(false);
  const [linkingFamily, setLinkingFamily] = useState(false);
  const load = () => api<Record<string, unknown>>("/me").then(setProfile);
  useEffect(() => {
    void load();
    api<{ campuses: CampusCatalogItem[]; ministries: Ministry[] }>("/catalog")
      .then((catalog) => {
        setCampuses(catalog.campuses);
        setMinistries(catalog.ministries);
      })
      .catch((error) => notify((error as Error).message));
  }, []);
  const household = (profile.household ?? []) as Array<Record<string, string | number>>;
  const hasVolunteerProfile = Boolean(profile.volunteer_id);
  const profileName =
    personName(profile.first_name, profile.middle_name, profile.last_name) ||
    String(profile.display_name || profile.email || "VolunteerHub user");
  const save = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const formData = new FormData(formEvent.currentTarget);
    const data = Object.fromEntries(formData);
    const payload = hasVolunteerProfile
      ? {
          firstName: data.firstName,
          middleName: data.middleName,
          lastName: data.lastName,
          birthDate: data.birthDate,
          phone: data.phone,
          emergencyContactName: data.emergencyContactName,
          emergencyContactPhone: data.emergencyContactPhone,
          smsConsent: data.smsConsent === "on",
          emailOptIn: data.emailOptIn === "on",
          pushOptIn: data.pushOptIn === "on"
        }
      : {
          displayName: data.displayName,
          phone: data.phone
        };
    const payloadWithHomeCampuses = {
      ...payload,
      homeCampusIds: formData.getAll("homeCampusIds").map(String),
      ministryMembershipIds: formData.getAll("ministryMembershipIds").map(String)
    };
    try {
      await api("/me", {
        method: "PATCH",
        body: JSON.stringify(payloadWithHomeCampuses)
      });
      await load();
      setEditing(false);
      notify("Profile updated.");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const linkFamilyMember = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    const data = Object.fromEntries(new FormData(formEvent.currentTarget));
    try {
      await api("/household/dependents", {
        method: "POST",
        body: JSON.stringify({
          firstName: data.firstName,
          middleName: data.middleName,
          lastName: data.lastName,
          birthDate: data.birthDate,
          relationship: data.relationship,
          dependentParticipationConsent: data.dependentParticipationConsent === "on"
        })
      });
      await load();
      setLinkingFamily(false);
      notify("Family member linked and submitted for approval.");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="Account"
        title="Profile"
        description="Keep your contact information and notification preferences current."
      />
      <div className="content-grid">
        <Card title="Your profile">
          <div className="profile-head">
            <div className="avatar large" aria-hidden="true">
              {initials(profileName)}
            </div>
            <span>
              <h3>{profileName}</h3>
              <p>{String(profile.email ?? "")}</p>
            </span>
            {!editing && (
              <button className="secondary" onClick={() => setEditing(true)}>
                <Pencil size={15} /> Edit profile
              </button>
            )}
          </div>
          <div className="profile-facts">
            {hasVolunteerProfile ? (
              <span>
                <ShieldCheck /> Application <strong>{String(profile.application_status ?? "")}</strong>
              </span>
            ) : (
              <span>
                <ShieldCheck /> Access{" "}
                <strong>{((profile.roles as string[]) ?? []).map(formatRoleName).join(", ")}</strong>
              </span>
            )}
            <span>
              <MessageSquareText /> SMS consent <strong>{profile.sms_consent ? "Enabled" : "Disabled"}</strong>
            </span>
            <span>
              <Building2 /> Home campus <strong>{String(profile.home_campus_name ?? "Campus not assigned")}</strong>
            </span>
            <span>
              <Users /> Ministries{" "}
              <strong>{((profile.ministry_membership_ids as string[]) ?? []).length || "None"}</strong>
            </span>
          </div>
          {editing && (
            <form className="profile-form" onSubmit={save}>
              {hasVolunteerProfile ? (
                <>
                  <Field name="firstName" label="First name" defaultValue={String(profile.first_name ?? "")} />
                  <OptionalField
                    name="middleName"
                    label="Middle name (optional)"
                    defaultValue={String(profile.middle_name ?? "")}
                  />
                  <Field name="lastName" label="Last name" defaultValue={String(profile.last_name ?? "")} />
                  <div className="two-col">
                    <Field
                      name="birthDate"
                      label="Birth date"
                      type="date"
                      defaultValue={String(profile.birth_date ?? "").slice(0, 10)}
                    />
                    <label>
                      Email
                      <input value={String(profile.email ?? "")} readOnly />
                    </label>
                  </div>
                </>
              ) : (
                <div className="two-col">
                  <Field name="displayName" label="Display name" defaultValue={profileName} />
                  <label>
                    Email
                    <input value={String(profile.email ?? "")} readOnly />
                  </label>
                </div>
              )}
              <Field name="phone" label="Mobile phone" type="tel" defaultValue={String(profile.phone ?? "")} />
              <CampusBubbleSelector campuses={campuses} selectedIds={(profile.home_campus_ids as string[]) ?? []} />
              <MinistryBubbleSelector
                ministries={ministries}
                selectedIds={(profile.ministry_membership_ids as string[]) ?? []}
              />
              {hasVolunteerProfile && (
                <>
                  <div className="two-col">
                    <OptionalField
                      name="emergencyContactName"
                      label="Emergency contact name"
                      defaultValue={String(profile.emergency_contact_name ?? "")}
                    />
                    <OptionalField
                      name="emergencyContactPhone"
                      label="Emergency contact phone"
                      type="tel"
                      defaultValue={String(profile.emergency_contact_phone ?? "")}
                    />
                  </div>
                  <div className="profile-preferences">
                    <strong>Notification preferences</strong>
                    <label className="check-label">
                      <input name="smsConsent" type="checkbox" defaultChecked={Boolean(profile.sms_consent)} />
                      Receive SMS notifications
                    </label>
                    <label className="check-label">
                      <input name="emailOptIn" type="checkbox" defaultChecked={Boolean(profile.email_opt_in)} />
                      Receive email notifications
                    </label>
                    <label className="check-label">
                      <input name="pushOptIn" type="checkbox" defaultChecked={Boolean(profile.push_opt_in)} />
                      Receive push notifications
                    </label>
                  </div>
                </>
              )}
              <div className="profile-form-actions">
                <button className="secondary" type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="primary">Save profile</button>
              </div>
            </form>
          )}
        </Card>
        <Card title="Household">
          <div className="household-list">
            {household.map((member) => (
              <div key={member.id}>
                <div className="avatar compact" aria-hidden="true">
                  {initials(personName(member.first_name, member.middle_name, member.last_name))}
                </div>
                <span>
                  <strong>{personName(member.first_name, member.middle_name, member.last_name)}</strong>
                  <small>
                    {member.relationship}
                    {member.guardian_managed ? " · Managed by you" : ""}
                    {member.application_status ? ` · ${member.application_status}` : ""}
                  </small>
                </span>
                <ChevronRight size={17} />
              </div>
            ))}
          </div>
          {linkingFamily ? (
            <form className="household-form" onSubmit={linkFamilyMember}>
              <Field name="firstName" label="First name" />
              <OptionalField name="middleName" label="Middle name (optional)" />
              <Field name="lastName" label="Last name" />
              <div className="two-col">
                <Field name="birthDate" label="Birth date" type="date" />
                <label>
                  Relationship
                  <select name="relationship" defaultValue="Child">
                    <option>Child</option>
                    <option>Dependent</option>
                    <option>Sibling</option>
                    <option>Other family member</option>
                  </select>
                </label>
              </div>
              <label className="check-label">
                <input name="dependentParticipationConsent" type="checkbox" required />I am authorized to manage this
                dependent and consent to their participation.
              </label>
              <small className="form-help">
                This creates a managed dependent and submits them for administrator approval before they can serve.
                Existing adult accounts require an invitation flow and cannot be linked here.
              </small>
              <div className="profile-form-actions">
                <button className="secondary" type="button" onClick={() => setLinkingFamily(false)}>
                  Cancel
                </button>
                <button className="primary">Link family member</button>
              </div>
            </form>
          ) : (
            <button className="secondary full" onClick={() => setLinkingFamily(true)}>
              <Plus size={16} /> Link family member
            </button>
          )}
        </Card>
      </div>
    </>
  );
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  );
}
function Breadcrumbs({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <div className="breadcrumbs" role="navigation" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={item.label}>
          {index > 0 && <ChevronRight size={14} />}
          {item.onClick ? (
            <button onClick={item.onClick}>{item.label}</button>
          ) : (
            <strong aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</strong>
          )}
        </span>
      ))}
    </div>
  );
}
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-header">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function MaintenanceCard({
  icon,
  title,
  description,
  count,
  onClick
}: {
  icon: ReactNode;
  title: string;
  description: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className="maintenance-card" onClick={onClick}>
      <span className="maintenance-card-icon">{icon}</span>
      <span className="grow">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {count !== undefined && count > 0 && <span className="maintenance-count">{count}</span>}
      <ChevronRight size={19} />
    </button>
  );
}
function MaintenanceFormTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="campus-form-title">
      <span className="attention-icon teal">{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </div>
  );
}
function ActiveCheckbox({ label, checked }: { label: string; checked: boolean }) {
  return (
    <label className="check-label">
      <input name="isActive" type="checkbox" defaultChecked={checked} />
      {label}
    </label>
  );
}
function MaintenanceFormActions({ editing, cancel }: { editing: boolean; cancel: () => void }) {
  return (
    <div className="card-actions">
      <button className="primary">{editing ? "Save changes" : "Create record"}</button>
      <button className="secondary" type="button" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}
function Attention({
  icon,
  tone,
  title,
  subtitle
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="attention">
      <span className={`attention-icon ${tone}`}>{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <ChevronRight size={17} />
    </div>
  );
}
function Opportunity({ event, onOpen }: { event: EventItem; onOpen: () => void }) {
  return (
    <button className="opportunity" onClick={onOpen}>
      <span className="ministry">{event.groups.map((group) => group.name).join(" · ")}</span>
      <h3>{event.name}</h3>
      <p>
        <CalendarDays size={15} /> {formatDate(event.starts_at)}
      </p>
      <p>
        <MapPin size={15} /> {event.campus_name}
      </p>
      <div>
        <span>{event.required_count - event.confirmed_count} spots open</span>
        <ChevronRight size={18} />
      </div>
    </button>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <ClipboardCheck />
      <p>{text}</p>
    </div>
  );
}
function LeaderSelector({
  leaders,
  selectedIds,
  inputName = "eventLeaderUserIds",
  title = "Event leaders",
  searchPlaceholder = "Search Administrators or Event Leaders",
  emptyMessage = "No active Administrators or Event Leaders are available."
}: {
  leaders: EventLeader[];
  selectedIds: string[];
  inputName?: string;
  title?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
}) {
  const [selected, setSelected] = useState(selectedIds);
  const [searchTerm, setSearchTerm] = useState("");
  const selectedLeaders = leaders.filter((leader) => selected.includes(leader.id));
  const availableLeaders = leaders.filter((leader) => !selected.includes(leader.id));
  const leaderName = (leader: EventLeader) => leader.display_name || leader.email;
  const roleName = (leader: EventLeader) =>
    leader.roles
      .filter((role) => role !== "VOLUNTEER")
      .map(formatRoleName)
      .join(", ");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const roleSearch = normalizedSearch.startsWith(":");
  const rolePrefix = normalizedSearch.slice(1);
  const matchingLeaders = normalizedSearch
    ? availableLeaders.filter((leader) =>
        roleSearch
          ? leader.roles
              .filter((role) => role !== "VOLUNTEER")
              .some((role) => [role, formatRoleName(role)].some((value) => value.toLowerCase().startsWith(rolePrefix)))
          : [leaderName(leader), leader.email, roleName(leader)].some((value) =>
              value.toLowerCase().includes(normalizedSearch)
            )
      )
    : [];

  return (
    <div className="leader-selector">
      <span className="leader-selector-title">{title}</span>
      {selected.map((id) => (
        <input key={id} name={inputName} type="hidden" value={id} />
      ))}
      <div className="leader-candidate-search">
        <Search size={16} />
        <input
          type="search"
          value={searchTerm}
          placeholder={searchPlaceholder}
          aria-label="Search eligible event leaders"
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>
      {!!selectedLeaders.length && (
        <>
          <span className="leader-selector-label">Selected members</span>
          <div className="leader-chips">
            {selectedLeaders.map((leader) => (
              <button
                className="leader-chip selected"
                type="button"
                key={leader.id}
                title={`Remove ${leaderName(leader)}`}
                onClick={() => setSelected(selected.filter((id) => id !== leader.id))}
              >
                <span>
                  <strong>{leaderName(leader)}</strong>
                  <small>{roleName(leader)}</small>
                </span>
                <X size={15} />
              </button>
            ))}
          </div>
        </>
      )}
      {normalizedSearch && (
        <div className="leader-candidate-results">
          {matchingLeaders.map((leader) => (
            <button
              type="button"
              key={leader.id}
              onClick={() => {
                setSelected([...selected, leader.id]);
                setSearchTerm("");
              }}
            >
              <span>
                <strong>{leaderName(leader)}</strong>
                <small>
                  {leader.email} · {roleName(leader)}
                </small>
              </span>
              <Plus size={16} />
            </button>
          ))}
          {!matchingLeaders.length && <small>No eligible candidates match your search.</small>}
        </div>
      )}
      {!leaders.length && <small>{emptyMessage}</small>}
    </div>
  );
}
function CampusBubbleSelector({
  campuses,
  selectedIds,
  inputName = "homeCampusIds",
  title = "Home locations",
  emptyLabel = "Add home location",
  addAnotherLabel = "Add another location",
  helpText = "My Campus includes these locations plus off-site events.",
  onChange
}: {
  campuses: CampusCatalogItem[];
  selectedIds: string[];
  inputName?: string;
  title?: string;
  emptyLabel?: string;
  addAnotherLabel?: string;
  helpText?: string;
  onChange?: (selectedIds: string[]) => void;
}) {
  const [selected, setSelected] = useState(selectedIds);
  const [campusId, setCampusId] = useState("");
  const selectedCampuses = selected
    .map((id) => campuses.find((campus) => campus.id === id))
    .filter(Boolean) as CampusCatalogItem[];
  const availableCampuses = campuses.filter((campus) => !selected.includes(campus.id));
  useEffect(() => onChange?.(selected), [onChange, selected]);

  return (
    <div className="campus-bubble-selector">
      <span className="leader-selector-title">{title}</span>
      {selected.map((id) => (
        <input key={id} name={inputName} type="hidden" value={id} />
      ))}
      <div className="campus-bubble-field">
        {selectedCampuses.map((campus) => (
          <button
            className="campus-bubble"
            type="button"
            key={campus.id}
            title={`Remove ${campus.name}`}
            onClick={() => setSelected((current) => current.filter((id) => id !== campus.id))}
          >
            <Building2 size={14} />
            <span>{campus.name}</span>
            <X size={14} />
          </button>
        ))}
        <select
          value={campusId}
          onChange={(event) => {
            const nextCampusId = event.target.value;
            if (nextCampusId) setSelected((current) => [...current, nextCampusId]);
            setCampusId("");
          }}
        >
          <option value="">{selected.length ? addAnotherLabel : emptyLabel}</option>
          {availableCampuses.map((campus) => (
            <option key={campus.id} value={campus.id}>
              {campus.name}
            </option>
          ))}
        </select>
      </div>
      <small className="form-help">{helpText}</small>
    </div>
  );
}
function MinistryBubbleSelector({
  ministries,
  selectedIds,
  inputName = "ministryMembershipIds",
  title = "Ministry membership",
  emptyLabel = "Add ministry",
  addAnotherLabel = "Add another ministry",
  helpText = "Select each ministry you serve with or want to stay connected to."
}: {
  ministries: Ministry[];
  selectedIds: string[];
  inputName?: string;
  title?: string;
  emptyLabel?: string;
  addAnotherLabel?: string;
  helpText?: string;
}) {
  const [selected, setSelected] = useState(selectedIds);
  const [ministryId, setMinistryId] = useState("");
  const selectedMinistries = selected
    .map((id) => ministries.find((ministry) => ministry.id === id))
    .filter(Boolean) as Ministry[];
  const availableMinistries = ministries.filter((ministry) => ministry.is_active && !selected.includes(ministry.id));

  return (
    <div className="campus-bubble-selector">
      <span className="leader-selector-title">{title}</span>
      {selected.map((id) => (
        <input key={id} name={inputName} type="hidden" value={id} />
      ))}
      <div className="campus-bubble-field">
        {selectedMinistries.map((ministry) => (
          <button
            className="campus-bubble"
            type="button"
            key={ministry.id}
            title={`Remove ${ministry.name}`}
            onClick={() => setSelected((current) => current.filter((id) => id !== ministry.id))}
          >
            <Users size={14} />
            <span>{ministry.name}</span>
            <X size={14} />
          </button>
        ))}
        <select
          value={ministryId}
          onChange={(event) => {
            const nextMinistryId = event.target.value;
            if (nextMinistryId) setSelected((current) => [...current, nextMinistryId]);
            setMinistryId("");
          }}
        >
          <option value="">{selected.length ? addAnotherLabel : emptyLabel}</option>
          {availableMinistries.map((ministry) => (
            <option key={ministry.id} value={ministry.id}>
              {ministry.name}
            </option>
          ))}
        </select>
      </div>
      <small className="form-help">{helpText}</small>
    </div>
  );
}
function Field({
  name,
  label,
  type = "text",
  defaultValue
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | number;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        step={type === "datetime-local" ? 1800 : undefined}
        required
      />
    </label>
  );
}
function DateTimeField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  const initial = splitDateTime(defaultValue);
  const [date, setDate] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState(initial.period);
  const hiddenValue = date ? `${date}T${toTwentyFourHour(hour, period)}:${minute}` : "";

  return (
    <label className="datetime-field">
      {label}
      <input name={name} type="hidden" value={hiddenValue} />
      <div className="datetime-control">
        <input
          className="datetime-date"
          type="date"
          value={date}
          required
          onChange={(event) => setDate(event.target.value)}
        />
        <select aria-label={`${label} hour`} value={hour} onChange={(event) => setHour(event.target.value)}>
          {hourOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select aria-label={`${label} minute`} value={minute} onChange={(event) => setMinute(event.target.value)}>
          <option value="00">00</option>
          <option value="15">15</option>
          <option value="30">30</option>
          <option value="45">45</option>
        </select>
        <select aria-label={`${label} AM or PM`} value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </label>
  );
}
function OptionalField({
  name,
  label,
  type = "text",
  defaultValue
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | number;
}) {
  return (
    <label>
      {label}
      <input name={name} type={type} defaultValue={defaultValue} step={type === "number" ? "any" : undefined} />
    </label>
  );
}
function LocationField({
  name,
  label,
  value,
  onChange,
  required = true,
  disabled = false
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        step="any"
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
function formatDateRange(startsAt: string, endsAt: string) {
  return `${formatDate(startsAt)} – ${formatDate(endsAt)}`;
}
function formatMessageTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?"
  );
}
function eventLocation(event: EventItem) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return event.address && normalize(event.address) !== normalize(event.campus_address)
    ? event.address
    : event.campus_name;
}
function eventMatchesHomeCampus(event: EventItem, session: Session) {
  if (event.matches_home_campus) return true;
  const participatingCampusIds = event.participating_campus_ids ?? [];
  if (session.homeCampusIds.some((campusId) => participatingCampusIds.includes(campusId))) return true;
  if (session.homeCampusIds.includes(event.campus_id)) return true;

  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const homeCampusNames = session.homeCampus.split(",").map(normalize).filter(Boolean);
  const eventCampusNames = [event.campus_name, ...(event.participating_campus_names ?? [])].map(normalize);
  return homeCampusNames.some((homeCampusName) => eventCampusNames.includes(homeCampusName));
}
function googleMapsDirectionsUrl(location: {
  latitude: number;
  longitude: number;
  address: string;
  campus_address: string;
  campus_name: string;
}) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0);
  const destination = hasCoordinates
    ? `${latitude},${longitude}`
    : location.address || location.campus_address || location.campus_name;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
function commitmentLocation(commitment: CommitmentItem) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return commitment.address && normalize(commitment.address) !== normalize(commitment.campus_address)
    ? commitment.address
    : commitment.campus_name;
}
function toDateTimeLocal(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const hourOptions = Array.from({ length: 12 }, (_, index) => String(index === 0 ? 12 : index).padStart(2, "0"));
function splitDateTime(value?: string) {
  const [date = "", time = ""] = value?.split("T") ?? [];
  const [rawHour = "09", rawMinute = "00"] = time.split(":");
  const hour24 = Number(rawHour);
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return {
    date,
    hour: String(hour12).padStart(2, "0"),
    minute: Number(rawMinute) >= 30 ? "30" : "00",
    period
  };
}
function toTwentyFourHour(hour: string, period: string) {
  const hourNumber = Number(hour);
  if (period === "AM") return String(hourNumber === 12 ? 0 : hourNumber).padStart(2, "0");
  return String(hourNumber === 12 ? 12 : hourNumber + 12).padStart(2, "0");
}
