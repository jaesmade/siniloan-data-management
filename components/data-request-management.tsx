"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle, DownloadSimple, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";
import type { RequestType } from "./app-shared";

type RequestRow = {
  id: string;
  control_number: string | null;
  original_control_number: string | null;
  request_type: RequestType;
  requester_name: string;
  requester_email: string | null;
  institution_office: string | null;
  research_title_purpose: string;
  date_received: string | null;
  status: string;
  created_at: string;
  release_method: string | null;
  release_notes: string | null;
};

type Queue = "Incoming" | "For release" | "Released";

export function DataRequestManagement({ requestType }: { requestType: RequestType }) {
  return <RequestQueue key={requestType} requestType={requestType} />;
}

function RequestQueue({ requestType }: { requestType: RequestType }) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [queue, setQueue] = useState<Queue>("Incoming");
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [method, setMethod] = useState("email");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [ascending, setAscending] = useState(true);
  const title = requestType === "data_request" ? "Data Requests" : "Interview Requests";
  const requestName = requestType === "data_request" ? "data request" : "interview request";

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      let query = createClient().schema("research").from("requests")
        .select("id,control_number,original_control_number,request_type,requester_name,requester_email,institution_office,research_title_purpose,date_received,status,created_at,release_method,release_notes")
        .eq("request_type", requestType)
        .order("control_number", { ascending, nullsFirst: false });
      if (signal) query = query.abortSignal(signal);
      const { data, error: queryError } = await query;
      if (signal?.aborted) return;
      if (queryError) throw queryError;
      setRows((data ?? []) as RequestRow[]);
    } catch {
      if (!signal?.aborted) {
        setRows([]);
        setLoadError(`${title} could not be loaded. Please retry.`);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [ascending, requestType, title]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setSelected(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected, saving]);

  const visible = useMemo(() => rows.filter(row => {
    if (queue === "Incoming") return ["received", "needs_information"].includes(row.status);
    return row.status === (queue === "For release" ? "approved" : "released");
  }), [rows, queue]);
  const missing = rows.filter(row => !row.control_number).length;

  const decide = async (action: "approve" | "return" | "release") => {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: decisionError } = await createClient().schema("core").rpc("transition_data_request", {
        p_request_id: selected.id,
        p_action: action,
        p_method: action === "release" ? method : null,
        p_notes: notes.trim() || null,
      });
      if (decisionError) throw decisionError;
      setNotice(action === "approve"
        ? "Request approved and moved to For release."
        : action === "release" ? "Request marked as released." : "Request returned for more information.");
      setSelected(null);
      setNotes("");
      await load();
    } catch (decisionError) {
      const message = (decisionError as { message?: unknown } | null)?.message;
      setError(typeof message === "string" ? message : "The decision could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const openAttachment = async (id: string, kind: "identification" | "request_letter") => {
    setError("");
    try {
      const { data } = await createClient().auth.getSession();
      if (!data.session) {
        setError("Your session has ended. Sign in again to view private attachments.");
        return;
      }
      const response = await fetch(`/api/data-requests/${id}/${kind}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error("The private image could not be opened. Please try again.");
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("The private image could not be opened. Please try again.");
    }
  };

  return <div className="page">
    <header className="page-header">
      <div><h1>{title}</h1><p>Review {requestName}s, confirm the decision, then record release details.</p></div>
      <button className="button secondary" onClick={() => setAscending(value => !value)} aria-label={`Sort control numbers ${ascending ? "descending" : "ascending"}`}>
        {ascending ? <ArrowUp /> : <ArrowDown />} Control number
      </button>
    </header>
    {error && !selected && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="success-notice" role="status">{notice}</p>}
    {!loading && missing > 0 && <div className="import-warning"><WarningCircle /><span>{missing} {requestName}{missing === 1 ? " is" : "s are"} missing a control number and {missing === 1 ? "needs" : "need"} review.</span></div>}
    <div className="tabs" role="group" aria-label={`${title} queue`}>
      {(["Incoming", "For release", "Released"] as Queue[]).map(item => <button key={item} className={queue === item ? "active" : ""} aria-pressed={queue === item} onClick={() => setQueue(item)}>{item}</button>)}
    </div>
    <section className="panel request-management-list" aria-label={title} aria-busy={loading}>
      {loading ? <div className="empty-state" role="status"><SpinnerGap className="spin" /><p>Loading {requestName}s…</p></div>
        : loadError ? <div className="empty-state" role="alert"><WarningCircle /><p>{loadError}</p><button className="button secondary" onClick={() => void load()}>Retry</button></div>
          : visible.length === 0 ? <div className="empty-state"><CheckCircle /><h2>No {queue.toLowerCase()} {requestName}s</h2><p>{queue === "Incoming" ? `${title} will appear here when submitted.` : queue === "For release" ? `Approved ${requestName}s will appear here.` : `Released ${requestName}s will appear here.`}</p></div>
            : visible.map(item => <button className="request-management-row" key={item.id} onClick={() => { setSelected(item); setNotes(""); setMethod("email"); setError(""); }}>
              <span className="request-management-number">{item.control_number ?? "Missing control no."}</span>
              <span><strong>{item.requester_name}</strong><small>{item.institution_office ?? "No institution supplied"}</small></span>
              <span className="badge badge-neutral">{item.status.replaceAll("_", " ")}</span>
            </button>)}
    </section>
    {selected && <div className="modal-backdrop"><section className="panel request-review-dialog" role="dialog" aria-modal="true" aria-labelledby="request-review-title">
      <header><div><span className="request-management-number">{selected.control_number ?? "Missing control number"}</span><h2 id="request-review-title">{requestType === "data_request" ? "Data request" : "Interview request"}</h2></div><button className="icon-button" onClick={() => setSelected(null)} disabled={saving} aria-label="Close request review" autoFocus><X /></button></header>
      <dl>
        <div><dt>Requester</dt><dd>{selected.requester_name}</dd></div>
        <div><dt>Email</dt><dd>{selected.requester_email ?? "Not provided"}</dd></div>
        <div><dt>Institution</dt><dd>{selected.institution_office ?? "Not provided"}</dd></div>
        <div><dt>Purpose</dt><dd>{selected.research_title_purpose}</dd></div>
        <div><dt>Original reference</dt><dd>{selected.original_control_number ?? "None"}</dd></div>
      </dl>
      <div className="request-attachments">
        <button className="button secondary" onClick={() => void openAttachment(selected.id, "identification")}><DownloadSimple /> View ID image</button>
        <button className="button secondary" onClick={() => void openAttachment(selected.id, "request_letter")}><DownloadSimple /> View request image</button>
      </div>
      {queue === "For release" && <label>Delivery method<select value={method} onChange={event => setMethod(event.target.value)}><option value="email">Email</option><option value="in_person">In person</option><option value="office_pickup">Office pickup</option><option value="other">Other</option></select></label>}
      {queue !== "Released" && <label>{queue === "For release" ? "Release notes" : "Decision note"}<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer>{queue === "Incoming" ? <>
        <button className="button secondary" disabled={saving || !notes.trim()} onClick={() => void decide("return")}>Return for information</button>
        <button className="button primary" disabled={saving} onClick={() => void decide("approve")}>{saving ? <SpinnerGap className="spin" /> : <CheckCircle />} Approve request</button>
      </> : queue === "For release" ? <button className="button primary" disabled={saving} onClick={() => void decide("release")}>{saving ? <SpinnerGap className="spin" /> : <CheckCircle />} Mark as released</button> : <p>Released via {selected.release_method ?? "recorded method"}{selected.release_notes && <> · {selected.release_notes}</>}</p>}</footer>
    </section></div>}
  </div>;
}
