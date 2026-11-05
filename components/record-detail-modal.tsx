"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, IdentificationCard, SpinnerGap, Trash, X } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; [key: string]: unknown };
type Database = "research" | "tupad";
type Entry = [string, unknown];

const names: Record<Database, string> = {
  research: "Data & Interview Requests",
  tupad: "TUPAD Beneficiaries",
};
const systemFields = new Set(["id", "department_id", "subject_id", "location_id", "import_job_id", "source_row_number", "created_by", "updated_by", "version", "archived_at", "created_at", "updated_at"]);
const primaryOrder: Record<Database, string[]> = {
  research: ["control_number", "requester_name", "institution_office", "research_title_purpose", "category", "date_received", "submitted_at", "status", "assigned_to", "decision_notes"],
  tupad: ["source_number", "full_name", "first_name", "middle_name", "last_name", "extension_name", "birth_date", "age", "sex", "civil_status", "barangay", "city_municipality", "province", "district", "id_type", "id_number", "contact_number", "bank_account_number", "beneficiary_type", "occupation", "average_monthly_income", "dependent", "interested_in_skills_training", "skills_training_needed", "remarks", "source_sheet"],
};
const sourceLabels: Record<string, string> = {
  institution_office: "Institution / office",
  research_title_purpose: "Research title / purpose",
  submitted_at: "Submitted at",
  date_received: "Date received",

};

function label(key: string) {
  return sourceLabels[key] ?? key.replaceAll("_", " ").toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase()).replace(/\bId\b/g, "ID").replace(/\bOfw\b/g, "OFW");
}

function ordered(entries: Entry[], priority: string[] = []): Entry[] {
  return [...entries].sort(([first], [second]) => {
    const firstPosition = priority.indexOf(first);
    const secondPosition = priority.indexOf(second);
    if (firstPosition !== -1 || secondPosition !== -1) return (firstPosition === -1 ? Infinity : firstPosition) - (secondPosition === -1 ? Infinity : secondPosition);
    return label(first).localeCompare(label(second));
  });
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && !Array.isArray(value) && value !== null && Object.keys(value).length === 0);
}

function valueText(value: unknown): string {
  if (isEmpty(value)) return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(valueText).join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function Fields({ entries, showEmpty }: { entries: Entry[]; showEmpty: boolean }) {
  const visible = showEmpty ? entries : entries.filter(([, value]) => !isEmpty(value));
  if (!visible.length) return <p className="record-detail-empty">No values were provided in this section.</p>;
  return <dl className="record-detail-grid">{visible.map(([key, value]) => <div className={isEmpty(value) ? "is-empty" : ""} key={key}><dt title={key}>{label(key)}</dt><dd>{valueText(value)}</dd></div>)}</dl>;
}

function DetailSection({ title, entries, showEmpty }: { title: string; entries: Entry[]; showEmpty: boolean }) {
  if (!entries.length) return null;
  const filled = entries.filter(([, value]) => !isEmpty(value)).length;
  if (!filled && !showEmpty) return null;
  return <section className="record-detail-section"><div className="record-detail-section-heading"><h3>{title}</h3><span>{filled} {filled === 1 ? "field" : "fields"}</span></div><Fields entries={entries} showEmpty={showEmpty} /></section>;
}

export function RecordDetailModal({ database, record, onClose, onEdit, canDelete=false, onDeleted }: { database: Database; record: Row; onClose: () => void; onEdit?: () => void; canDelete?:boolean; onDeleted?:()=>void }) {
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const [deleteError,setDeleteError]=useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled),summary,input:not(:disabled)"));
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus(); };
  }, [onClose]);

  const primary = ordered(Object.entries(record).filter(([key]) => !systemFields.has(key) && key !== "metadata" && key !== "raw_source"), primaryOrder[database]);
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? Object.entries(record.metadata) : [];
  const source = record.raw_source && typeof record.raw_source === "object" && !Array.isArray(record.raw_source) ? Object.entries(record.raw_source) : [];
  const system = Object.entries(record).filter(([key]) => systemFields.has(key));
  const metadataGroups = [{ title: "Additional form and import fields", entries: ordered(metadata) }];
  const title = String(database==="tupad" ? record.full_name || [record.first_name,record.middle_name,record.last_name,record.extension_name].filter(Boolean).join(" ") || "Beneficiary" : record.requester_name || "Request");
  const status = database==="tupad" ? record.beneficiary_type : record.status;
  const filledCount = [...primary, ...metadata, ...source].filter(([, value]) => !isEmpty(value)).length;
  const deleteRecord=async()=>{setDeleting(true);setDeleteError("");const {error}=await createClient().schema("core").rpc("delete_record",{p_module:database,p_record_id:record.id});if(error){setDeleteError(error.message);setDeleting(false);return;}onDeleted?.();onClose();};

  return <div className="modal-backdrop record-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="record-modal record-detail-modal" role="dialog" aria-modal="true" aria-labelledby="record-detail-title" aria-describedby="record-detail-description">
      <header className="record-modal-header record-detail-header"><div className="record-modal-icon"><IdentificationCard weight="duotone" /></div><div><p id="record-detail-description" className="record-detail-context">{names[database]} · Record details</p><h2 id="record-detail-title">{title}</h2><div className="record-detail-header-meta"><span>{filledCount} saved {filledCount === 1 ? "field" : "fields"}</span>{!isEmpty(status) && <span className="record-detail-status">{valueText(status)}</span>}</div></div><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close record details"><X /></button></header>
      <div className="record-detail-body">
        <div className="record-detail-toolbar"><p>Saved fields from this record.</p><label><input type="checkbox" checked={showEmpty} onChange={event => setShowEmpty(event.target.checked)} /> Show empty fields</label></div>
        <DetailSection title="Record information" entries={primary} showEmpty={showEmpty} />
        {metadataGroups.map(group => <DetailSection key={group.title} title={group.title} entries={group.entries} showEmpty={showEmpty} />)}
        <DetailSection title="Original source fields" entries={source} showEmpty={showEmpty} />
        <details className="record-detail-system"><summary>Record history and identifiers <CaretDown aria-hidden="true" /></summary><Fields entries={system} showEmpty={showEmpty} /></details>
      </div>
      <footer className="record-modal-actions"><span>Full record · {names[database]}</span><div>{canDelete&&<button type="button" className="button danger" onClick={()=>setConfirmDelete(true)}><Trash/> Delete</button>}<button type="button" className="button secondary" onClick={onClose}>Close</button>{onEdit&&<button type="button" className="button primary" onClick={onEdit}>Edit record</button>}</div></footer>{confirmDelete&&<div className="record-delete-confirm"><p>This permanently deletes the record and records the action in the audit log.</p>{deleteError&&<p className="form-error" role="alert">{deleteError}</p>}<button className="button secondary" onClick={()=>setConfirmDelete(false)} disabled={deleting}>Cancel</button><button className="button danger-solid" onClick={()=>void deleteRecord()} disabled={deleting}>{deleting?<><SpinnerGap className="spin"/> Deleting…</>:"Delete record"}</button></div>}
    </section>
  </div>;
}
