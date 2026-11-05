"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckCircle, IdentificationCard, SpinnerGap, X } from "@phosphor-icons/react";

import { createClient } from "@/lib/supabase/client";

type DatabaseKey = "research";
type Department = { id: string; code: string; name: string };

const databaseNames: Record<DatabaseKey,string> = { research: "Data & Interview Requests" };
const initialValues = { department_id:"", requester_name:"", institution_office:"", research_title_purpose:"", category:"", request_type:"data_request", control_number:"", date_received:"", status:"received", decision_notes:"" };

export type EditableRecord = { id: string; version?: number; [key: string]: unknown };
const fieldValue=(value:unknown)=>value===null||value===undefined?"":String(value);
function valuesForRecord(record:EditableRecord) {
  const values={...initialValues};
  for(const field of Object.keys(initialValues) as Array<keyof typeof initialValues>) {
    values[field]=fieldValue(record[field]);
  }
  values.status=fieldValue(record.status)||"received";
  return values;
}

export function AddRecordModal({ database, record, role="dpo", onClose, onSaved }: { database: DatabaseKey; record?: EditableRecord; role?: "dpo"|"office_focal"; onClose: () => void; onSaved: (message: string) => void }) {
  const editing=Boolean(record);
  const [values,setValues]=useState(()=>record?valuesForRecord(record):initialValues);
  const [departments,setDepartments]=useState<Department[]>([]);
  const [loadingDepartments,setLoadingDepartments]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const dialogRef=useRef<HTMLElement>(null);
  const formRef=useRef<HTMLFormElement>(null);
  const update=(field:keyof typeof initialValues,value:string)=>setValues(current=>({...current,[field]:value}));

  useEffect(()=>{
    let active=true;
    const supabase=createClient();
    const load=async()=>{
      const authResult=await supabase.auth.getUser();
      const departmentResult=await supabase.schema("core").from("departments").select("id, code, name").eq("is_active",true).order("name");
      const profileResult=authResult.data.user
        ? await supabase.schema("core").from("profiles").select("department_id").eq("id",authResult.data.user.id).maybeSingle()
        : {data:null,error:null};
      if(!active)return;
      if(departmentResult.error){setError("Departments could not be loaded.");}
      else {
        const next=(departmentResult.data??[]) as Department[];
        setDepartments(next);
        setValues(current=>({...current,department_id:current.department_id||profileResult.data?.department_id||next[0]?.id||""}));
      }
      setLoadingDepartments(false);
    };
    load().catch(()=>{if(active){setError("Departments could not be loaded.");setLoadingDepartments(false);}});
    return()=>{active=false;};
  },[]);

  useEffect(()=>{
    const previous=document.body.style.overflow; document.body.style.overflow="hidden";
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!saving){onClose();return;}
      if(event.key!=="Tab"||!dialogRef.current)return;
      const items=Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'));
      if(!items.length)return;
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",keydown);
    return()=>{document.body.style.overflow=previous;document.removeEventListener("keydown",keydown);};
  },[onClose,saving]);

  const submit=async(event:FormEvent)=>{
    event.preventDefault(); setSaving(true); setError("");
    const payload={...values};
    const client=createClient();
    const {error:saveError}=role==="office_focal"
      ? (record ? {error:{message:"Focalpersons cannot edit existing records."}} : await client.schema("core").rpc("stage_manual_submission",{p_module:database,p_data:payload}))
      : record
        ? await client.schema("core").rpc("update_manual_record",{p_module:database,p_record_id:record.id,p_version:record.version??1,p_data:payload})
        : await client.schema("core").rpc("create_research_request",{p_data:payload});
    if(saveError){
      setError(saveError.code==="23505"?"A record with the same unique identifier already exists.":saveError.code==="40001"?"This record changed while you were editing. Close this form, refresh records, and try again.":saveError.message);
      setSaving(false); return;
    }
    onSaved(role==="office_focal"?`Submission sent to the DPO for review.`:`Record ${editing?"updated in":"added to"} ${databaseNames[database]}.`);
  };

  return <div className="modal-backdrop record-modal-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!saving)onClose()}}>
    <section ref={dialogRef} className="record-modal" role="dialog" aria-modal="true" aria-labelledby="add-record-title" aria-describedby="add-record-description">
      <header className="record-modal-header"><div className="record-modal-icon"><IdentificationCard weight="duotone"/></div><div><h2 id="add-record-title">{editing?"Edit":"Add to"} {databaseNames[database]}</h2><p id="add-record-description">{editing?"Update this record using the fields from its source form.":"Enter one record using the fields from this database's source form."}</p></div><button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Close record dialog"><X/></button></header>
      <form ref={formRef} onSubmit={submit} className="record-modal-form">
        {<div className="record-form-section"><div className="record-section-heading"><div><h3>Record ownership</h3><p>Choose the municipal department responsible for this record.</p></div></div><div className="record-form-grid"><label className="span-2">Department <b>*</b><select autoFocus value={values.department_id} onChange={e=>update("department_id",e.target.value)} required disabled={loadingDepartments}><option value="">{loadingDepartments?"Loading departments…":"Select department"}</option>{departments.map(item=><option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label></div></div>}
        <ResearchFields values={values} update={update}/>
        {error&&<p className="form-error record-form-error" role="alert">{error}</p>}
        <footer className="record-modal-actions"><span><CheckCircle/> Required fields are marked with *</span><div><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>{<button type="submit" className="button primary" disabled={saving||loadingDepartments}>{saving?<><SpinnerGap className="spin"/> Saving record…</>:editing?"Save changes":"Add record"}</button>}</div></footer>
      </form>
    </section>
  </div>;
}

type FieldsProps={values:typeof initialValues;update:(field:keyof typeof initialValues,value:string)=>void};
function ResearchFields({values,update}:FieldsProps){return <><div className="record-form-section"><div className="record-section-heading"><div><h3>Requester and purpose</h3><p>Identity, institution, and requested research use.</p></div></div><div className="record-form-grid"><label>Request type<select value={values.request_type} onChange={e=>update("request_type",e.target.value)}><option value="data_request">Data Request</option><option value="interview_request">Interview Request</option></select></label><label>Requester name <b>*</b><input value={values.requester_name} onChange={e=>update("requester_name",e.target.value)} maxLength={160} required/></label><label>School / institution / office<input value={values.institution_office} onChange={e=>update("institution_office",e.target.value)} maxLength={240}/></label><label className="span-2">Research title / purpose <b>*</b><textarea value={values.research_title_purpose} onChange={e=>update("research_title_purpose",e.target.value)} maxLength={1000} required/></label><label>Category<input value={values.category} onChange={e=>update("category",e.target.value)} maxLength={120}/></label><label>Control number<input value="Assigned automatically" readOnly aria-readonly="true"/></label></div></div><div className="record-form-section"><div className="record-section-heading"><div><h3>Request tracking</h3><p>Initial status and receipt information.</p></div></div><div className="record-form-grid"><label>Date received<input type="date" value={values.date_received} onChange={e=>update("date_received",e.target.value)}/></label><label>Status<select value={values.status} onChange={e=>update("status",e.target.value)}><option value="received">Received</option><option value="under_review">Under review</option><option value="needs_information">Needs information</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="released">Released</option><option value="closed">Closed</option></select></label><label className="span-2">Decision notes<textarea value={values.decision_notes} onChange={e=>update("decision_notes",e.target.value)} maxLength={1000}/></label></div></div></>}
