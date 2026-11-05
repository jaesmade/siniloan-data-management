"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Clock, Eye, SpinnerGap, XCircle } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

type Item = {
  id: string;
  submission_type: string;
  source_filename: string | null;
  total_rows: number;
  created_at: string;
  datasets: { name: string; slug: string } | null;
};
type PreviewRow = Record<string, unknown>;
const PAGE_SIZE = 25;

export function DataSubmissionReview() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const { data, count, error } = await createClient().schema("core")
        .from("data_submissions")
        .select("id,submission_type,source_filename,total_rows,created_at,datasets(name,slug)", { count: "exact" })
        .eq("status", "pending_review")
        .order("created_at")
        .order("id")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .abortSignal(signal);
      if (signal.aborted) return;
      if (error) throw new Error(error.message);
      const nextTotal = count ?? 0;
      setTotal(nextTotal);
      const lastPage = Math.max(0, Math.ceil(nextTotal / PAGE_SIZE) - 1);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setItems((data ?? []) as unknown as Item[]);
    } catch (error) {
      if (!signal.aborted) setLoadError(error instanceof Error ? error.message : "Submissions could not be loaded. Please refresh.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, refreshKey]);

  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const loadPreview = async () => {
      try {
        const { data, error } = await createClient().schema("core")
          .rpc("data_submission_preview", { p_submission_id: selectedId })
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) throw new Error(error.message);
        if (!Array.isArray(data)) throw new Error("This submission is no longer awaiting review. Close it and refresh the queue.");
        setPreview(data as PreviewRow[]);
      } catch (error) {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "The preview could not be loaded. Close it and try again.");
      }
    };
    void loadPreview();
    return () => controller.abort();
  }, [selectedId]);

  const refresh = () => { setLoading(true); setRefreshKey(value => value + 1); };
  const openPreview = (item: Item) => {
    setPreview(null);
    setPreviewError("");
    setFeedback("");
    setError("");
    setSelected(item);
  };
  const decide = async (decision: "approve" | "return" | "reject") => {
    if (!selected || !preview || saving) return;
    setSaving(true);
    setError("");
    try {
      const { data, error } = await createClient().schema("core").rpc("review_data_submission", {
        p_submission_id: selected.id, p_decision: decision, p_feedback: feedback,
      });
      if (error) throw new Error(error.message);
      setNotice(decision === "approve" ? data.accepted + " rows approved and committed." : decision === "return" ? "Submission returned to the focalperson with feedback." : "Submission rejected.");
      setSelected(null);
      setFeedback("");
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The decision could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const decisionDisabled = saving || preview === null || Boolean(previewError);

  return <div className="page">
    <header className="page-header"><div><h1>Import approvals</h1><p>Review submitted records and mapped files before anything enters the live databases.</p></div></header>
    {notice && <p className="success-notice" role="status">{notice}</p>}
    <section className="panel">
      <div className="panel-header"><div><h2>Waiting for review</h2><p>{total} submission{total === 1 ? "" : "s"}</p></div><button className="button secondary" disabled={loading} onClick={refresh}>Refresh</button></div>
      {loading ? <div className="empty-state" role="status"><SpinnerGap className="spin"/><p>Loading submissions…</p></div>
        : loadError ? <div className="empty-state" role="alert"><p>{loadError}</p><button className="button secondary" onClick={refresh}>Retry</button></div>
        : items.length === 0 ? <div className="empty-state"><CheckCircle/><h2>Queue is clear</h2><p>New focalperson submissions will appear here.</p></div>
        : <div className="history-list">{items.map(item => <article key={item.id}>
          <span className="activity-icon amber"><Clock/></span>
          <div><strong>{item.source_filename ?? "Manual entry · " + (item.datasets?.name ?? "Dataset")}</strong><p>{item.datasets?.name ?? "Dataset"} · {item.total_rows} rows · {new Date(item.created_at).toLocaleString("en-PH")}</p></div>
          <button className="button secondary" onClick={() => openPreview(item)}><Eye/> Preview</button>
        </article>)}</div>}
      {total > PAGE_SIZE && <div className="pagination">
        <span role="status">Page {page + 1} of {pages} · {total} submissions</span>
        <div><button aria-label="Previous submissions page" disabled={loading || page === 0} onClick={() => { setLoading(true); setPage(value => value - 1); }}>‹</button><button aria-label="Next submissions page" disabled={loading || page + 1 >= pages} onClick={() => { setLoading(true); setPage(value => value + 1); }}>›</button></div>
      </div>}
    </section>
    {selected && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setSelected(null); }}>
      <section className="panel submission-review-dialog" role="dialog" aria-modal="true" aria-labelledby="submission-review-title">
        <header className="panel-header"><div><h2 id="submission-review-title">Review {selected.datasets?.name ?? "Dataset"}</h2><p>{selected.source_filename ?? "Manual entry"} · {selected.total_rows} rows</p></div><button className="icon-button" disabled={saving} onClick={() => setSelected(null)} aria-label="Close review">×</button></header>
        {previewError ? <p className="form-error" role="alert">{previewError}</p>
          : preview === null ? <div className="empty-state" role="status"><SpinnerGap className="spin"/><p>Loading preview…</p></div>
          : <><div className="submission-preview">{preview.map((row, index) => <dl key={index}>{Object.entries(row).filter(([key]) => !["metadata", "raw_source"].includes(key)).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value ?? "—")}</dd></div>)}{row.raw_source!==null&&typeof row.raw_source==="object"&&<div><dt>Original source fields</dt><dd><details><summary>Show all imported fields</summary>{Object.entries(row.raw_source).map(([key,value])=><p key={key}><strong>{key}: </strong>{value!==null&&typeof value==="object"?JSON.stringify(value,null,2):String(value??"—")}</p>)}</details></dd></div>}{selected.datasets?.slug==="tupad_beneficiaries"&&row.metadata!==null&&typeof row.metadata==="object"&&<div style={{gridColumn:"1 / -1"}}><dt>Source metadata</dt><dd><details><summary>Workbook context and source details</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontFamily:"inherit",marginBottom:0}}>{JSON.stringify(row.metadata,null,2)}</pre></details></dd></div>}</dl>)}</div>{selected.total_rows > 30 && <p>Showing 30 of {selected.total_rows} rows. Approval applies to the full submission.</p>}</>}
        <label>Review note<textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={1000} placeholder="Required when returning or rejecting"/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="confirmation-actions">
          <button className="button danger" disabled={decisionDisabled} onClick={() => void decide("reject")}><XCircle/> Reject</button>
          <button className="button secondary" disabled={decisionDisabled || !feedback.trim()} onClick={() => void decide("return")}>Return for correction</button>
          <button className="button primary" disabled={decisionDisabled} onClick={() => void decide("approve")}>{saving ? <><SpinnerGap className="spin"/> Applying…</> : <><CheckCircle/> Approve &amp; commit</>}</button>
        </footer>
      </section>
    </div>}
  </div>;
}
