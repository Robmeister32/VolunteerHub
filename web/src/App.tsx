import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  BarChart3,
  CalendarRange,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Gauge,
  Layers3,
  LineChart,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  UsersRound
} from "lucide-react";
import { api, login, logout } from "./api";
import { auth } from "./firebase";

interface Staffing {
  event_name: string;
  required: number;
  filled: number;
}

interface Report {
  staffing: Staffing[];
  compliance: Array<{ count: number }>;
  attendance: Array<{ status: string; count: number }>;
}

const navigation = [
  [Gauge, "Executive overview"],
  [CalendarRange, "Service planning"],
  [LineChart, "Forecasting"],
  [UsersRound, "Volunteer capacity"],
  [ClipboardList, "Requirements"],
  [BarChart3, "Reports"]
] as const;

export function App() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [accountName, setAccountName] = useState("Administrator");

  useEffect(() => {
    return auth.onAuthStateChanged((user) => {
      setAuthenticated(Boolean(user));
      setAccountName(user?.displayName || user?.email?.split("@")[0] || "Administrator");
      if (user)
        api<Report>("/reports/overview")
          .then(setReport)
          .catch((reason) => setError(reason.message));
    });
  }, []);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await login(String(data.get("email")), String(data.get("password")));
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  if (!authenticated)
    return (
      <div className="web-login">
        <div className="login-card">
          <div className="brand">
            <span>
              <Sparkles size={19} />
            </span>
            <strong>VolunteerHub</strong>
            <small>Planning</small>
          </div>
          <span className="eyebrow">Administration</span>
          <h1>Plan with confidence.</h1>
          <p>Sign in with an administrator or leader account.</p>
          <form onSubmit={signIn}>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" required />
            </label>
            <button className="primary">Sign in</button>
          </form>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    );

  const totalRequired = report?.staffing.reduce((sum, row) => sum + Number(row.required), 0) ?? 0;
  const totalFilled = report?.staffing.reduce((sum, row) => sum + Number(row.filled), 0) ?? 0;
  const coverage = totalRequired ? Math.round((totalFilled / totalRequired) * 100) : 0;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span>
            <Sparkles size={19} />
          </span>
          <strong>VolunteerHub</strong>
          <small>Planning</small>
        </div>
        <nav>
          {navigation.map(([Icon, label], index) => (
            <button className={index === 0 ? "active" : ""} key={label}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <button>
            <Settings size={17} /> Settings
          </button>
          <button onClick={() => void logout()}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
      <main>
        <header>
          <button className="menu">
            <Menu />
          </button>
          <div className="search">
            <Search size={17} />
            Search plans, ministries, reports
          </div>
          <span className="period">Planning horizon: 90 days</span>
          <div className="avatar" aria-label={accountName}>
            {initials(accountName)}
          </div>
        </header>
        <div className="page">
          <div className="page-title">
            <div>
              <span className="eyebrow">Operational intelligence</span>
              <h1>Plan with confidence.</h1>
              <p>Anticipate volunteer needs and keep every ministry ready.</p>
            </div>
            <button className="primary">Create planning scenario</button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="metrics">
            <Metric
              label="Upcoming coverage"
              value={`${coverage}%`}
              detail={`${totalFilled} of ${totalRequired} positions`}
              icon={<TrendingUp />}
              tone="teal"
            />
            <Metric
              label="Open positions"
              value={totalRequired - totalFilled}
              detail="Across upcoming events"
              icon={<CircleAlert />}
              tone="amber"
            />
            <Metric
              label="Volunteer capacity"
              value="74%"
              detail="Based on recent availability"
              icon={<UsersRound />}
              tone="blue"
            />
            <Metric
              label="Forecast confidence"
              value="High"
              detail="Enough historical activity"
              icon={<Layers3 />}
              tone="violet"
            />
          </div>
          <div className="grid">
            <section className="card wide">
              <CardHeader
                title="Staffing forecast"
                subtitle="Required positions compared with expected coverage"
                action="View forecast"
              />
              <div className="chart">
                {(report?.staffing ?? []).map((row) => {
                  const pct = Math.round((Number(row.filled) / Math.max(1, Number(row.required))) * 100);
                  return (
                    <div className="bar-row" key={row.event_name}>
                      <span>
                        <strong>{row.event_name}</strong>
                        <small>
                          {row.filled} confirmed / {row.required} required
                        </small>
                      </span>
                      <div className="bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <b>{pct}%</b>
                    </div>
                  );
                })}
                {!report && <div className="loading">Loading operational data...</div>}
              </div>
            </section>
            <section className="card">
              <CardHeader title="Planning signals" subtitle="Items likely to need intervention" />
              <div className="signals">
                <Signal
                  tone="critical"
                  title="Kids Ministry coverage risk"
                  body="Nine open positions remain for the next service."
                />
                <Signal
                  tone="warning"
                  title="Seasonal demand increase"
                  body="Welcome Team demand is projected to rise 18%."
                />
                <Signal
                  tone="good"
                  title="Training readiness improving"
                  body="Compliance completion is trending upward."
                />
              </div>
            </section>
          </div>
          <section className="card">
            <CardHeader
              title="Ministry readiness"
              subtitle="Current staffing and operational posture"
              action="Open capacity planner"
            />
            <div className="readiness-table">
              <div className="table-head">
                <span>Ministry</span>
                <span>Upcoming demand</span>
                <span>Coverage</span>
                <span>Readiness</span>
                <span />
              </div>
              <Readiness name="Kids Ministry" demand="10 positions" coverage="10%" status="At risk" tone="critical" />
              <Readiness name="Welcome Team" demand="8 positions" coverage="0%" status="Needs action" tone="warning" />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className="metric">
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function CardHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: string }) {
  return (
    <div className="card-header">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button>
          {action}
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

function Signal({ tone, title, body }: { tone: string; title: string; body: string }) {
  return (
    <div className="signal">
      <i className={tone} />
      <span>
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
      <ChevronRight size={16} />
    </div>
  );
}

function Readiness({
  name,
  demand,
  coverage,
  status,
  tone
}: {
  name: string;
  demand: string;
  coverage: string;
  status: string;
  tone: string;
}) {
  return (
    <div className="table-row">
      <strong>{name}</strong>
      <span>{demand}</span>
      <span>{coverage}</span>
      <span className={`status ${tone}`}>{status}</span>
      <button>
        <ChevronRight size={16} />
      </button>
    </div>
  );
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
