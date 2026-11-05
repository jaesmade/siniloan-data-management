"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle, IdentificationCard, ShieldCheck, SpinnerGap, UploadSimple } from "@phosphor-icons/react";
import type { RequestType } from "./app-shared";

function RequestImageField({ id, title, hint, file, required, onChange }: {
  id: string;
  title: string;
  hint: string;
  file: File | null;
  required?: boolean;
  onChange: (file: File | null) => void;
}) {
  const [issue, setIssue] = useState("");
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setIssue("");
    if (nextFile && nextFile.size > 5 * 1024 * 1024) {
      setIssue("This image is over 5 MB. Choose a smaller file.");
      onChange(null);
      event.target.value = "";
      return;
    }
    onChange(nextFile);
  };

  return <div className={`request-upload ${file ? "has-file" : ""}`}>
    <input id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} required={required && !file}/>
    <label htmlFor={id} className="request-upload-control">
      <span className="request-upload-icon">{file ? <CheckCircle weight="fill"/> : <UploadSimple/>}</span>
      <span className="request-upload-copy"><strong>{file?.name ?? title}</strong><small>{file ? `${(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB · Ready to upload` : hint}</small></span>
      <span className="request-upload-action">{file ? "Replace" : "Browse"}</span>
    </label>
    {issue && <small className="request-upload-error" role="alert">{issue}</small>}
  </div>;
}

export function GuestRequestForm({ requestType, onBack }: { requestType: RequestType; onBack: () => void }) {
  const isInterview = requestType === "interview_request";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [institution, setInstitution] = useState("");
  const [purpose, setPurpose] = useState("");
  const [identification, setIdentification] = useState<File | null>(null);
  const [letter, setLetter] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ control_number: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!identification || !letter) {
      setError("Attach both your ID image and request letter image to continue.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("request_type", requestType);
    form.set("requester_name", name.trim());
    form.set("email", email.trim());
    form.set("institution_office", institution.trim());
    form.set("research_title_purpose", purpose.trim());
    form.set("identification", identification);
    form.set("request_letter", letter);

    try {
      const response = await fetch("/api/data-requests", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Your request could not be submitted.");
      setReceipt(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Your request could not be submitted.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="guest-request-page">
    <div className="guest-request-shell">
      <header className="guest-request-top">
        <div className="guest-landing-brand"><span className="seal"><span>S</span></span><span>Municipality of Siniloan<br/><strong>Enterprise Data Management</strong></span></div>
        <button type="button" className="guest-home-link" onClick={onBack}><ArrowLeft/> Return to home</button>
      </header>

      <div className={`guest-request-layout ${receipt ? "receipt-layout" : ""}`}>
        {!receipt && <aside className="guest-request-aside">

          <h1>{isInterview ? "Request an interview." : "Request municipal data."}</h1>
          <p className="guest-request-intro">{isInterview ? "Tell us who you would like to interview, the topic, and how to contact you." : "Tell us what municipal data you need, how it will be used, and how to contact you."} The Data Privacy Officer reviews each request before a decision is made.</p>
          <div className="guest-request-steps">
            <div><span>1</span><p><strong>Tell us about yourself</strong><small>Provide your name and a working email address.</small></p></div>
            <div><span>2</span><p><strong>{isInterview ? "Describe the interview" : "Describe the data you need"}</strong><small>{isInterview ? "Explain your topic and the purpose of the interview." : "Explain which information you need and its purpose."}</small></p></div>
            <div><span>3</span><p><strong>Attach two images</strong><small>Include an ID image and an image of your request letter.</small></p></div>
          </div>
          <div className="guest-privacy-note"><ShieldCheck/><p><strong>Private review</strong><small>Your attachments are kept private for DPO review.</small></p></div>
        </aside>}

        <section className="panel guest-request-card">
          {receipt ? <div className="guest-receipt">
            <span className="guest-receipt-icon"><CheckCircle weight="fill"/></span>
            <h1>{isInterview ? "Interview request received" : "Data request received"}</h1>
            <p>Your {isInterview ? "interview" : "data"} request has been submitted for DPO review. Keep this reference number for your records.</p>
            <div className="guest-reference"><span>Request control number</span><strong>{receipt.control_number}</strong></div>
            <div className="guest-receipt-note"><ShieldCheck/><span>{isInterview ? "The DPO will review your interview request before a decision is made." : "The DPO will review your submission before any data is released."}</span></div>
            <button type="button" className="button primary" onClick={onBack}>Return to home <ArrowRight/></button>
          </div> : <>
            <header className="guest-form-heading"><div><h2>{isInterview ? "Interview request details" : "Data request details"}</h2><p>Fields marked required must be completed.</p></div><span className="guest-required-note"><i/> Required</span></header>
            <form onSubmit={submit}>
              <fieldset className="guest-form-section">
                <legend>Your details</legend>
                <div className="guest-form-grid">
                  <label>Full name <span className="required-mark">*</span><input value={name} onChange={e => setName(e.target.value)} maxLength={160} autoComplete="name" placeholder="Name as shown on your ID" required/></label>
                  <label>Email address <span className="required-mark">*</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} autoComplete="email" placeholder="you@example.com" required/></label>
                  <label className="guest-form-wide">School, institution, or office <span className="guest-optional">Optional</span><input value={institution} onChange={e => setInstitution(e.target.value)} maxLength={240} autoComplete="organization" placeholder="Where you are making this request from"/></label>
                </div>
              </fieldset>

              <fieldset className="guest-form-section">
                <legend>{isInterview ? "Interview information" : "Data requested"}</legend>
                <div className="guest-form-grid">
                  <label className="guest-form-wide">{isInterview ? "Interview topic and purpose" : "Data needed and purpose"} <span className="required-mark">*</span><textarea value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={1000} placeholder={isInterview ? "Who would you like to interview, what topics will you cover, and how will the interview be used?" : "Describe the municipal data you need and how it will be used."} required/><small className="field-hint">{purpose.length}/1000 characters</small></label>
                </div>
              </fieldset>

              <fieldset className="guest-form-section guest-attachments-section">
                <legend>Supporting images</legend>
                <p className="guest-section-hint">Upload a clear image of your ID and a clear image of your request letter. JPG, PNG, or WebP; maximum 5 MB each.</p>
                <div className="guest-upload-grid">
                  <div><span className="guest-upload-label"><IdentificationCard/> Identification image <span className="required-mark">*</span></span><RequestImageField id="request-identification" title="Choose ID image" hint="Browse for your ID image" file={identification} required onChange={setIdentification}/></div>
                  <div><span className="guest-upload-label"><UploadSimple/> Request letter image <span className="required-mark">*</span></span><RequestImageField id="request-letter" title="Choose request image" hint="Browse for your request letter" file={letter} required onChange={setLetter}/></div>
                </div>
              </fieldset>

              {error && <p className="guest-form-error" role="alert">{error}</p>}
              <footer className="guest-submit-row"><span><ShieldCheck/> Attachments are kept private for review.</span><button type="submit" className="button primary" disabled={busy}>{busy ? <><SpinnerGap className="spin"/> Submitting…</> : <>Submit {isInterview ? "interview" : "data"} request <ArrowRight/></>}</button></footer>
            </form>
          </>}
        </section>
      </div>
    </div>
  </main>;
}
