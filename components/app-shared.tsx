import type { AccountStatus, AppRole, DatasetSlug } from "@/lib/database/types";

export type DatabaseKey = "research" | "tupad";
export type RequestType = "data_request" | "interview_request";

export type AuthProfile = { id: string; full_name: string; username: string; email: string; role: AppRole; status: AccountStatus };

export type AccountTab = "approvals" | "users";

export const databaseMeta: Record<DatabaseKey, { name: string; short: string; color: string }> = {
  research: { name: "Data & Interview Requests", short: "RQ", color: "#0f766e" },
  tupad: { name: "TUPAD Beneficiaries", short: "TB", color: "#1e5aa8" },
};

export const datasetSlugs: Record<DatabaseKey, DatasetSlug> = {
  research: "research_requests",
  tupad: "tupad_beneficiaries",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</div>;
}

export function ScreenLoading() {
  return <div className="empty-state" role="status">Loading…</div>;
}
