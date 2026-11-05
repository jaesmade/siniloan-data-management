"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Badge, PageHeader, ScreenLoading, databaseMeta, type DatabaseKey, type AuthProfile, type AccountTab } from "./app-shared";
import { Archive, ArrowLeft, ArrowRight, Bell, CaretDown, UserCircle, Check, CheckCircle, Clock, Database, Eye, EyeSlash, FileArrowUp, Fingerprint, Gauge, House, IdentificationCard, Pulse, List, Lock, ShieldCheck, SignOut, SpinnerGap, UserPlus, Users, ClipboardText, WarningCircle, X } from "@phosphor-icons/react";

import { ProfileManager } from "./profile-manager";

import { Landing } from "./guest-landing";

import { createClient as createSupabaseClient } from "@/lib/supabase/client";

type Screen = "landing" | "requestData" | "login" | "register" | "pending" | "admin" | "databases" | "database" | "accountManagement" | "activity" | "submissions" | "dataRequests" | "staffHome" | "import";
type Role = "System Administrator" | "DPO" | "Office Focalperson" | "Staff";
type HeaderNotification = { id: number; action: string; summary: string; occurred_at: string; outcome: string; dataset_id: string | null };

function Seal() {
  return <div className="seal" aria-label="Municipality of Siniloan"><span>S</span></div>;
}

function AuthShell({ children, step }: { children: React.ReactNode; step?: string }) {
  return (
    <main className="auth-layout">
      <section className="auth-brand">
        <div className="auth-brand-inner">
          <div className="brand-lockup"><Seal /><div><span>Municipality of Siniloan</span><strong>Enterprise Data Management</strong></div></div>
          <div className="auth-message">
            <Badge tone="blue"><ShieldCheck weight="fill" /> Secure government system</Badge>
            <h1>One trusted place for municipal data.</h1>
            <p>Govern access, maintain reliable records, and understand activity across every municipal dataset.</p>
          </div>
          <div className="trust-row"><Lock weight="fill" /><span>Protected by role-based access and complete activity records</span></div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand"><Seal /><strong>Siniloan EDM</strong></div>
        {step && <div className="auth-step">{step}</div>}
        {children}
        <p className="auth-footer">Authorized municipal personnel only<br />© 2026 Municipality of Siniloan</p>
      </section>
    </main>
  );
}
type Department = { id: string; name: string };

function roleLabel(role: AuthProfile["role"]): Role {
  return role === "system_admin" ? "System Administrator" : role === "dpo" ? "DPO" : role === "office_focal" || role === "data_steward" ? "Office Focalperson" : "Staff";
}

function accountInitials(name: string) {
  return name.split(" ").filter(Boolean).map((part)=>part[0]).slice(0,2).join("").toUpperCase();
}

function Login({ navigate, onAuthenticated }: { navigate: (s: Screen) => void; onAuthenticated: (profile: AuthProfile) => void }) {
  const [visible, setVisible] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget); const username = String(form.get("username") ?? "").trim(); const password = String(form.get("password") ?? "");
    try {
      const response = await fetch("/api/auth/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json();
      if (!response.ok) { setError(payload.error ?? "We could not sign you in. Check your username and password."); return; }
      const supabase = createSupabaseClient(); const { data, error: signInError } = await supabase.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
      if (signInError || !data.user) { setError("We could not start your session. Please try again."); return; }
      const { data: profile, error: profileError } = await supabase.schema("core").from("profiles").select("id, full_name, username, email, role, status").eq("id", data.user.id).single();
      if (profileError || !profile) { setError("Your account profile is not ready. Please contact the Data Privacy Officer."); return; }
      if (profile.status !== "active") { navigate("pending"); return; }
      onAuthenticated(profile as AuthProfile);
    } catch { setError("Supabase is not available. Confirm the local services and environment variables are running."); } finally { setLoading(false); }
  };
  return <AuthShell><div className="auth-card"><div className="eyebrow">Welcome back</div><h2>Sign in to your account</h2><p className="supporting">Use your username and password registered with the municipal data portal.</p><form onSubmit={submit} className="form-stack"><label>Username<input name="username" type="text" autoComplete="username" placeholder="Enter your username" pattern="[A-Za-z0-9._-]{3,40}" required /></label><label>Password<div className="password-field"><input name="password" type={visible ? "text" : "password"} autoComplete="current-password" required /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeSlash /> : <Eye />}</button></div></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" type="submit" disabled={loading}>{loading ? <><SpinnerGap className="spin" /> Signing in…</> : <>Sign in <ArrowRight /></>}</button></form><div className="auth-switch">Need an account? <button className="link-button" onClick={() => navigate("register")}>Request access</button></div></div></AuthShell>;
}

function Register({ navigate }: { navigate: (s: Screen) => void }) {
  const [step, setStep] = useState(1); const [departments, setDepartments] = useState<Department[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ fullName: "", username: "", email: "", departmentId: "", password: "", confirmPassword: "", consent: false });
  useEffect(() => { createSupabaseClient().schema("core").from("departments").select("id, name").eq("is_active", true).order("name").then(({ data }: { data: unknown }) => setDepartments((data ?? []) as Department[])); }, []);
  const continueToPassword = () => { if (!values.fullName || !values.username || !values.email || !values.departmentId) { setError("Complete every required field before continuing."); return; } setError(""); setStep(2); };
  const submit = async () => { if (values.password.length < 12) { setError("Use a password with at least 12 characters."); return; } if (values.password !== values.confirmPassword) { setError("Passwords do not match."); return; } if (!values.consent) { setError("Confirm that the submitted details are correct."); return; } setLoading(true); setError(""); try { const supabase = createSupabaseClient(); const { error: signUpError } = await supabase.auth.signUp({ email: values.email, password: values.password, options: { data: { full_name: values.fullName, username: values.username, department_id: values.departmentId } } }); if (signUpError) { setError(signUpError.message); return; } navigate("pending"); } catch { setError("Supabase is not available. Confirm the local services and environment variables are running."); } finally { setLoading(false); } };
  const update = (field: keyof typeof values, value: string | boolean) => setValues((current) => ({ ...current, [field]: value }));
  return <AuthShell step={`Account request · Step ${step} of 2`}><div className="auth-card wide"><button className="back-link" onClick={() => step === 1 ? navigate("login") : setStep(1)}><ArrowLeft /> Back</button>{step === 1 ? <><div className="eyebrow">Request access</div><h2>Tell us about yourself</h2><p className="supporting">Your details will be reviewed by the Data Privacy Officer.</p><div className="form-grid"><label className="span-2">Full name<input value={values.fullName} onChange={(event) => update("fullName", event.target.value)} autoComplete="name" required /></label><label>Username<input value={values.username} onChange={(event) => update("username", event.target.value)} autoComplete="username" required /></label><label>Email address<input type="email" value={values.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" required /></label><label className="span-2">Department<select value={values.departmentId} onChange={(event) => update("departmentId", event.target.value)} required><option value="" disabled>{departments.length ? "Select your department" : "Loading departments…"}</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" onClick={continueToPassword}>Continue <ArrowRight /></button></> : <><div className="eyebrow">Secure your account</div><h2>Create a password</h2><p className="supporting">Use at least 12 characters. You can use a password manager.</p><div className="form-stack"><label>Password<input type="password" value={values.password} onChange={(event) => update("password", event.target.value)} autoComplete="new-password" required /></label><label>Confirm password<input type="password" value={values.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} autoComplete="new-password" required /></label></div><div className="password-rules"><span className={values.password.length >= 12 ? "met" : ""}><Check /> 12+ characters</span><span className={values.password === values.confirmPassword && values.password ? "met" : ""}><Check /> Passwords match</span></div><label className="consent"><input type="checkbox" checked={values.consent} onChange={(event) => update("consent", event.target.checked)} /> <span>I confirm these details are correct and understand that access is subject to DPO approval.</span></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full" onClick={submit} disabled={loading}>{loading ? <><SpinnerGap className="spin" /> Submitting…</> : <>Submit request <ArrowRight /></>}</button></>}</div></AuthShell>;
}

function StaffWorkspace({profile}:{profile:AuthProfile}) {
 return <div className="page"><PageHeader title={`Welcome, ${profile.full_name}`} description="Your account is active, but it does not currently have workspace permissions."/><section className="panel empty-state staff-no-access"><ShieldCheck/><h2>No access assigned</h2><p>Contact your System Administrator if your duties require access. You can still manage your profile or sign out from the account menu.</p></section></div>;
}
function Pending({ navigate }: { navigate: (s: Screen) => void }) {
  return <AuthShell><div className="status-card"><div className="status-icon"><Clock weight="fill" /></div><Badge tone="amber">Pending review</Badge><h2>Your request has been submitted</h2><p>The Data Privacy Officer will verify your account and assign access to the appropriate databases.</p><div className="request-summary"><div><span>Request number</span><strong>ACC-2026-0047</strong></div><div><span>Submitted</span><strong>September 20, 2026</strong></div><div><span>Department</span><strong>Municipal Planning & Development</strong></div></div><div className="next-steps"><strong>What happens next?</strong><ol><li><span>1</span>DPO verifies your identity and department</li><li><span>2</span>DPO assigns database access and permissions</li><li><span>3</span>You can sign in when your account is active</li></ol></div><button className="button secondary full" onClick={() => navigate("login")}><ArrowLeft /> Return to sign in</button></div></AuthShell>;
}

const navItems: { screen: Screen; label: string; icon: typeof House; roles?: Role[] }[] = [
  { screen: "admin", label: "Dashboard", icon: Gauge, roles: ["System Administrator", "DPO"] },
  { screen: "databases", label: "Database dashboard", icon: Database, roles: ["DPO"] },
  { screen: "accountManagement", label: "Account Management", icon: Users, roles: ["System Administrator", "DPO"] },
  { screen: "activity", label: "System activity", icon: Pulse, roles: ["System Administrator"] },
  { screen: "submissions", label: "Import approvals", icon: FileArrowUp, roles: ["DPO"] },
  { screen: "dataRequests", label: "Data Requests", icon: ClipboardText, roles: ["DPO"] },
  { screen: "databases", label: "My submissions", icon: ClipboardText, roles: ["Office Focalperson"] },
  { screen: "staffHome", label: "Workspace", icon: House, roles: ["Staff"] },
];

function AppShell({ screen, setScreen, openApprovals, profile, role, selectedDatabase, openDatabase, pendingApprovalCount, children, onSignOut, passwordRecovery, onRecoveryComplete }: { screen: Screen; setScreen: (s: Screen) => void; openApprovals: () => void; profile: AuthProfile; role: Role; selectedDatabase: DatabaseKey; openDatabase: (key: DatabaseKey) => void; pendingApprovalCount: number; children: React.ReactNode; onSignOut: () => Promise<void>; passwordRecovery: boolean; onRecoveryComplete: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [datasetRoutes, setDatasetRoutes] = useState<Record<string, DatabaseKey>>({});
  const [notificationsLoading, setNotificationsLoading] = useState(role === "DPO" || role === "System Administrator");
  const [notificationError, setNotificationError] = useState("");
  const [lastReadAt, setLastReadAt] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("notifications-read-" + profile.id) ?? "");
  const unreadCount = notifications.filter(item => !lastReadAt || new Date(item.occurred_at) > new Date(lastReadAt)).length + (role === "System Administrator" ? pendingApprovalCount : 0);
  const markAllRead = () => {
    const readAt = new Date().toISOString();
    setLastReadAt(readAt);
    window.localStorage.setItem("notifications-read-" + profile.id, readAt);
  };

  useEffect(() => {
    if (role !== "DPO" && role !== "System Administrator") return;
    const controller = new AbortController();
    const supabase = createSupabaseClient();
    let running = false;
    const load = async () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      try {
        let query = supabase.schema("core").from("audit_events")
          .select("id, action, summary, occurred_at, outcome, dataset_id")
          .order("occurred_at", { ascending: false }).limit(8);
        query = role === "DPO"
          ? query.or("dataset_id.not.is.null,action.like.submission.%")
          : query.is("dataset_id", null);
        const { data, error } = await query.abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw new Error(error.message);
        setNotifications((data ?? []) as HeaderNotification[]);
        setNotificationError("");
      } catch {
        if (!controller.signal.aborted) setNotificationError("Notifications could not be loaded.");
      } finally {
        running = false;
        if (!controller.signal.aborted) setNotificationsLoading(false);
      }
    };
    // Dataset IDs are stable for this session; load the routing map once.
    if (role === "DPO") {
      void supabase.schema("core").from("datasets").select("id, slug")
        .abortSignal(controller.signal).then(({ data }: { data: unknown }) => {
          if (controller.signal.aborted) return;
          const keys: Record<string, DatabaseKey> = {
            jobseeker_registry: "jobseekers", research_requests: "research", biometric_events: "biometrics",
          };
          const datasets = (data ?? []) as { id: string; slug: string }[];
          setDatasetRoutes(Object.fromEntries(datasets.filter(item => keys[item.slug]).map(item => [item.id, keys[item.slug]])));
        });
    }
    const onVisibilityChange = () => { if (!document.hidden) void load(); };
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [role]);

  const profileIsOpen = profileOpen || passwordRecovery;

  useEffect(() => {
    if (!confirmSignOut && !notificationOpen && !profileMenuOpen && !profileIsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!signingOut) setConfirmSignOut(false);
      setNotificationOpen(false);
      setProfileMenuOpen(false);
      if (profileIsOpen) {
        setProfileOpen(false);
        if (passwordRecovery) onRecoveryComplete();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [confirmSignOut, notificationOpen, profileMenuOpen, profileIsOpen, passwordRecovery, signingOut, onRecoveryComplete]);

  useEffect(() => {
    if (!confirmSignOut && !profileIsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [confirmSignOut, profileIsOpen]);

  const completeSignOut = async () => { setSigningOut(true); try { await onSignOut(); } finally { setSigningOut(false); setConfirmSignOut(false); } };
  const openNotification = (item: HeaderNotification) => {
    markAllRead();
    setNotificationOpen(false);
    if (item.action === "auth.login") { setScreen(role === "System Administrator" ? "activity" : "admin"); return; }
    const database = item.dataset_id ? datasetRoutes[item.dataset_id] : undefined;
    if (database) openDatabase(database);
    else setScreen("activity");
  };

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to main content</a>
    <aside className={"sidebar " + (mobileOpen ? "open" : "")}>
      <div className="sidebar-brand"><Seal /><div><strong>Siniloan EDM</strong><span>Enterprise Data Management</span></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></button></div>
      <nav aria-label="Main navigation">
        <div className="nav-label">Workspace</div>
        {navItems.filter(i => !i.roles || i.roles.includes(role)).map(item => <button key={item.screen} className={screen === item.screen ? "active" : ""} onClick={() => { setScreen(item.screen); setMobileOpen(false); }}><item.icon /><span>{item.label}</span>{item.screen === "accountManagement" && pendingApprovalCount > 0 && <em>{pendingApprovalCount}</em>}</button>)}
        <div className="nav-label">Databases</div>
        {role === "DPO" && (Object.keys(databaseMeta) as DatabaseKey[]).map(key => <button key={key} className={screen === "database" && selectedDatabase === key ? "subtle-active database-active" : ""} onClick={() => { openDatabase(key); setMobileOpen(false); }}><span className="db-dot" style={{ background: databaseMeta[key].color }} /> <span>{databaseMeta[key].name}</span></button>)}
      </nav>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <div className="app-main">
      <header className="topbar">
        <button className="menu-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><List /></button>
        <div className="top-actions">
          <button className="icon-button notification-trigger" aria-label={unreadCount ? "Notifications, " + unreadCount + " unread" : "Notifications"} aria-expanded={notificationOpen} aria-controls="notification-panel" onClick={() => { setNotificationOpen(current => !current); setProfileMenuOpen(false); }}>
            <Bell />{unreadCount > 0 && <span className="notification-trigger-count">{Math.min(unreadCount, 99)}</span>}
          </button>
          <div className="profile-menu-root">
            <button className="profile-trigger" aria-expanded={profileMenuOpen} onClick={() => { setProfileMenuOpen(current => !current); setNotificationOpen(false); }}>
              <span className="avatar">{accountInitials(profile.full_name)}</span>
              <span className="top-account-copy"><strong>{profile.full_name}</strong><small>{role}</small></span>
              <CaretDown />
            </button>
            {profileMenuOpen && <><button className="profile-menu-backdrop" aria-label="Close profile menu" onClick={() => setProfileMenuOpen(false)} /><div className="profile-menu">
              <div className="profile-menu-heading"><strong>{profile.full_name}</strong><small>{profile.email}</small></div>
              <button onClick={() => { setProfileMenuOpen(false); setProfileOpen(true); }}><UserCircle /> Profile</button>
              <button onClick={() => { setProfileMenuOpen(false); setConfirmSignOut(true); }}><SignOut /> Sign out</button>
            </div></>}
          </div>
        </div>
      </header>
      <main id="main-content">{children}</main>
    </div>
    {notificationOpen && <><button className="notification-backdrop" aria-label="Close notifications" onClick={() => setNotificationOpen(false)} /><aside className="notification-panel" id="notification-panel" aria-label="Notifications">
      <header><div><h2>Notifications</h2><p>Recent account and data activity</p></div>{unreadCount > 0 && <button onClick={markAllRead}>Mark all read</button>}</header>
      <div className="notification-list">
        {role === "System Administrator" && pendingApprovalCount > 0 && <button className="notification-item unread" onClick={() => { markAllRead(); setNotificationOpen(false); openApprovals(); }}><span className="activity-icon amber"><UserPlus /></span><span><strong>{pendingApprovalCount} account {pendingApprovalCount === 1 ? "request" : "requests"} waiting</strong><small>Review and assign database access</small></span></button>}
        {notificationsLoading ? <div className="notification-empty"><SpinnerGap className="spin" /><span>Loading notifications…</span></div> : notificationError ? <div className="notification-empty"><WarningCircle /><span>{notificationError}</span></div> : notifications.length === 0 && pendingApprovalCount === 0 ? <div className="notification-empty"><CheckCircle /><span>No new notifications.</span></div> : notifications.map(item => {
          const unread = !lastReadAt || new Date(item.occurred_at) > new Date(lastReadAt);
          const timestamp = new Date(item.occurred_at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
          const detail = item.action.replaceAll(".", " · ") + " · " + timestamp;
          return <button className={"notification-item " + (unread ? "unread" : "")} key={item.id} onClick={() => openNotification(item)}><span className={"activity-icon " + (item.outcome === "failure" ? "red" : item.action === "auth.login" ? "purple" : "blue")}>{item.outcome === "failure" ? <WarningCircle /> : item.action === "auth.login" ? <ShieldCheck /> : <Pulse />}</span><span><strong>{item.summary}</strong><small>{detail}</small></span></button>;
        })}
      </div>
      {role === "System Administrator" && <footer><button onClick={() => { markAllRead(); setNotificationOpen(false); setScreen("activity"); }}>View all system activity <ArrowRight /></button></footer>}
    </aside></>}
    {(profileOpen || passwordRecovery) && <ProfileManager profile={{ ...profile, role }} passwordRecovery={passwordRecovery} onClose={() => { setProfileOpen(false); if (passwordRecovery) onRecoveryComplete(); }} onRecoveryComplete={() => { setProfileOpen(true); onRecoveryComplete(); }} />}
    {confirmSignOut && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !signingOut) setConfirmSignOut(false); }}><section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="signout-title" aria-describedby="signout-description"><div className="confirmation-icon"><SignOut weight="duotone" /></div><h2 id="signout-title">Sign out of the system?</h2><p id="signout-description">Your secure session will end. You will need to enter your username and password to access municipal data again.</p><div className="confirmation-actions"><button className="button secondary" autoFocus onClick={() => setConfirmSignOut(false)} disabled={signingOut}>Cancel</button><button className="button danger-solid" onClick={completeSignOut} disabled={signingOut}>{signingOut ? <><SpinnerGap className="spin" /> Signing out…</> : <><SignOut /> Sign out</>}</button></div></section></div>}
  </div>;
}

function Databases({ openDatabase, importDatabase }: { openDatabase: (key: DatabaseKey) => void; importDatabase: (key: DatabaseKey) => void }) {
  return <div className="page"><PageHeader eyebrow="Workspace" title="My databases" description="Open the datasets you have permission to view or manage." />
    <div className="database-grid">{(Object.keys(databaseMeta) as DatabaseKey[]).map((key, i) => { const db = databaseMeta[key]; const Icon = [IdentificationCard, Archive, Fingerprint][i]; return <article className="database-card" key={key}><div className="db-card-head"><span style={{ color: db.color, background: `${db.color}14` }}><Icon weight="duotone" /></span><Badge tone={i === 1 ? "green" : "blue"}>{i === 1 ? "Read only" : "Read/write"}</Badge></div><h2>{db.name}</h2><p>{i === 0 ? "Employment profiles, qualifications, training and work preferences." : i === 1 ? "Requests, research purposes, reviews and controlled releases." : "Biometric attendance records, personnel, locations, and verification data."}</p><div className="db-card-meta"><div><strong>{db.count}</strong><span>records</span></div><div><strong>{db.updated}</strong><span>last updated</span></div></div><button className="button primary full" onClick={() => importDatabase(key)}><FileArrowUp /> Import data</button><button className="button secondary full" onClick={() => openDatabase(key)}>Open database <ArrowRight /></button></article>})}</div>
  </div>;
}

export function EnterpriseDataApp() {
  const [screen, setScreen] = useState<Screen>("landing"); const [role, setRole] = useState<Role>("Staff"); const [profile, setProfile] = useState<AuthProfile | null>(null); const [booting, setBooting] = useState(true);
  const [accountTab, setAccountTab] = useState<AccountTab>("approvals");
  const [selectedDatabase, setSelectedDatabase] = useState<DatabaseKey>("jobseekers");
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const openDatabase = (key: DatabaseKey) => { setSelectedDatabase(key); setScreen("database"); };
  const importDatabase = (key: DatabaseKey) => { setSelectedDatabase(key); setScreen("import"); };
  const openApprovals = () => { setAccountTab("approvals"); setScreen("accountManagement"); };
  const activateProfile = (nextProfile: AuthProfile) => { setProfile(nextProfile); setRole(roleLabel(nextProfile.role)); setScreen(nextProfile.status !== "active" ? "pending" : nextProfile.role === "staff" ? "staffHome" : nextProfile.role === "office_focal" ? "databases" : "admin"); };
  useEffect(() => {
    let active = true;
    const supabase = createSupabaseClient();
    const fallbackTimer = window.setTimeout(() => { if (active) setBooting(false); }, 8_000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });
    supabase.auth.getSession().then(async ({ data }: { data: { session: { user: { id: string } } | null } }) => {
      if (!data.session) return;
      const { data: nextProfile } = await supabase.schema("core").from("profiles").select("id, full_name, username, email, role, status").eq("id", data.session.user.id).maybeSingle();
      if (active && nextProfile) activateProfile(nextProfile as AuthProfile);
    }).catch(() => undefined).finally(() => {
      window.clearTimeout(fallbackTimer);
      if (active) setBooting(false);
    });
    return () => { active = false; window.clearTimeout(fallbackTimer); subscription.unsubscribe(); };
  }, []);  useEffect(() => { if (!profile || !["dpo","system_admin"].includes(profile.role) || profile.status !== "active") return; let active = true; const refreshCount = () => createSupabaseClient().schema("core").from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending").then(({ count }: { count: number | null }) => { if (active) setPendingApprovalCount(count ?? 0); }); refreshCount(); const timer = window.setInterval(refreshCount, 30_000); return () => { active = false; window.clearInterval(timer); }; }, [profile?.role, profile?.status]);
  const signOut = async () => { await createSupabaseClient().auth.signOut(); setProfile(null); setRole("Staff"); setPendingApprovalCount(0); setPasswordRecovery(false); setScreen("landing"); };
  if (booting) return <AuthShell><div className="status-card"><SpinnerGap className="spin" /><h2>Checking your secure session</h2><p>Loading your approved account and permissions.</p></div></AuthShell>;
  if (screen === "landing") return <Landing onRequest={()=>setScreen("requestData")} onSignIn={()=>setScreen("login")}/>;
  if (screen === "requestData") return <GuestRequestForm onBack={()=>setScreen("landing")}/>;
  if (screen === "login") return <Login navigate={setScreen} onAuthenticated={activateProfile} />;
  if (screen === "register") return <Register navigate={setScreen} />;
  if (screen === "pending") return <Pending navigate={setScreen} />;
  let content: React.ReactNode;
  switch(screen) {
    case "admin": content=profile&&(profile.role==="system_admin"||profile.role==="dpo")?<LiveAdminDashboard profile={profile} openDatabase={openDatabase}/>:null; break;
    case "databases": content=profile?.role==="office_focal"?<FocalWorkspace profile={{role:"office_focal",id:profile.id}} onImport={(key)=>{setSelectedDatabase(key);setScreen("import");}}/>:<Databases openDatabase={openDatabase} importDatabase={importDatabase}/>; break;
    case "database": content=profile?.role==="dpo"?<LiveModuleDashboard key={selectedDatabase} database={selectedDatabase} onImport={()=>setScreen("import")}/>:null; break;
    case "accountManagement": content=profile&&(profile.role==="dpo"||profile.role==="system_admin")?<AccountManagement role={profile.role} tab={accountTab} onTabChange={setAccountTab} pendingApprovalCount={pendingApprovalCount} onCountChange={setPendingApprovalCount}/>:null; break;
    case "submissions": content=profile?.role==="dpo"?<DataSubmissionReview/>:null; break;
    case "dataRequests": content=profile?.role==="dpo"?<DataRequestManagement/>:null; break;
    case "staffHome": content=profile?.role==="staff"?<StaffWorkspace profile={profile}/>:null; break;
    case "activity": content=profile?.role==="system_admin"?<SystemActivity/>:null; break;
    case "import": content=(profile?.role==="dpo"||profile?.role==="office_focal")?<div className="modal-backdrop import-modal-backdrop"><section className="panel import-modal"><button className="icon-button import-modal-close" onClick={()=>setScreen(profile.role==="office_focal"?"databases":"database")} aria-label="Close import">×</button><ImportFlow key={selectedDatabase} initialModule={selectedDatabase}/></section></div>:null; break;
    default: content=profile ? <LiveAdminDashboard profile={profile} openDatabase={openDatabase}/> : null;
  }
  return <AppShell screen={screen} setScreen={setScreen} openApprovals={openApprovals} profile={profile!} role={role} selectedDatabase={selectedDatabase} openDatabase={openDatabase} pendingApprovalCount={pendingApprovalCount} onSignOut={signOut} passwordRecovery={passwordRecovery} onRecoveryComplete={() => setPasswordRecovery(false)}>{content}</AppShell>;
}

const FocalWorkspace = dynamic(() => import("./focal-workspace").then(module => module.FocalWorkspace), { loading: ScreenLoading });

const DataSubmissionReview = dynamic(() => import("./data-submission-review").then(module => module.DataSubmissionReview), { loading: ScreenLoading });

const DataRequestManagement = dynamic(() => import("./data-request-management").then(module => module.DataRequestManagement), { loading: ScreenLoading });

const LiveModuleDashboard = dynamic(() => import("./live-dashboards").then(module => module.LiveModuleDashboard), { loading: ScreenLoading });

const LiveAdminDashboard = dynamic(() => import("./live-dashboards").then(module => module.LiveAdminDashboard), { loading: ScreenLoading });

const AccountManagement = dynamic(() => import("./account-management").then(module => module.AccountManagement), { loading: ScreenLoading });

const ImportFlow = dynamic(() => import("./import-flow").then(module => module.ImportFlow), { loading: ScreenLoading });

const SystemActivity = dynamic(() => import("./system-activity").then(module => module.SystemActivity), { loading: ScreenLoading });

const GuestRequestForm = dynamic(() => import("./guest-request-form").then(module => module.GuestRequestForm), { loading: ScreenLoading });
