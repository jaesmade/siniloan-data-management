"use client";

import { ArrowRight } from "@phosphor-icons/react";
import type { RequestType } from "./app-shared";

export function Landing({ onRequest, onSignIn }: { onRequest: (requestType: RequestType) => void; onSignIn: () => void }) {
  return <main className="guest-landing">
    <div className="guest-landing-brand"><span className="seal"><span>S</span></span><span>Municipality of Siniloan<br/><strong>Enterprise Data Management</strong></span></div>
    <section><h1>Request data or an interview</h1><p>Choose the request you need to send for review by the municipal Data Privacy Officer. Staff can sign in to their assigned workspace.</p><div className="guest-actions"><button className="button secondary" onClick={() => onRequest("data_request")}>Request data <ArrowRight/></button><button className="button secondary" onClick={() => onRequest("interview_request")}>Request an interview <ArrowRight/></button><button className="button primary" onClick={onSignIn}>Staff sign in</button></div></section>
    <footer>Requests are reviewed before a decision is made.</footer>
  </main>;
}
