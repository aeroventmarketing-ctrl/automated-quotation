"use client";

import { useRef, useState } from "react";

export interface RfqPrefill {
  c?: string;
  t?: string;
  company?: string;
  contactName?: string;
  email?: string;
}

const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#1f2933", margin: "0 0 5px" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14,
  border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#1f2933",
};

/**
 * Public RFQ submission form. Posts multipart form-data to /api/rfq, which stores
 * the files and drops the request into the Inbound RFQ review queue. Shows a
 * thank-you on success. Includes a honeypot ("website") that real users leave blank.
 */
export function RfqForm({ prefill }: { prefill: RfqPrefill }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/rfq", { method: "POST", body: new FormData(e.currentTarget) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
        <h2 style={{ fontSize: 18, color: "#1f2933", margin: "0 0 8px" }}>Thank you — your request is in.</h2>
        <p style={{ color: "#607080", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Our team has received your RFQ and will review it shortly. We&rsquo;ll get back to you at the email you provided
          with a quotation or any follow-up questions.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
      {prefill.c && <input type="hidden" name="c" value={prefill.c} />}
      {prefill.t && <input type="hidden" name="t" value={prefill.t} />}
      {/* Honeypot — hidden from people, tempting to bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} aria-hidden />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label style={label}>Company</label>
          <input style={input} name="company" defaultValue={prefill.company ?? ""} placeholder="Your company" />
        </div>
        <div>
          <label style={label}>Contact name</label>
          <input style={input} name="contactName" defaultValue={prefill.contactName ?? ""} placeholder="Your name" />
        </div>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label style={label}>Email <span style={{ color: "#dc2626" }}>*</span></label>
          <input style={input} type="email" name="email" required defaultValue={prefill.email ?? ""} placeholder="you@company.com" />
        </div>
        <div>
          <label style={label}>Phone</label>
          <input style={input} name="phone" placeholder="Mobile / landline" />
        </div>
      </div>
      <div>
        <label style={label}>What do you need? </label>
        <textarea style={{ ...input, minHeight: 96, resize: "vertical" }} name="message"
          placeholder="Describe your requirement — fan/blower type, airflow, static pressure, quantity, application, delivery location, etc." />
      </div>
      <div>
        <label style={label}>Attach your RFQ / drawings</label>
        <input
          type="file"
          name="files"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.xlsx,.xls,.csv,.doc,.docx,.ppt,.pptx,.dwg,.dxf,.zip,.rar,.7z,.txt"
          onChange={(e) => setFileNames(Array.from(e.target.files ?? []).map((f) => f.name))}
          style={{ fontSize: 13, color: "#1f2933" }}
        />
        <p style={{ color: "#94a3b8", fontSize: 12, margin: "6px 0 0" }}>
          PDF, images, Excel/Word, CAD (DWG/DXF) or ZIP · up to 10 files, 15&nbsp;MB each.
        </p>
        {fileNames.length > 0 && (
          <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", fontSize: 12, color: "#607080" }}>
            {fileNames.map((n, i) => <li key={i}>📎 {n}</li>)}
          </ul>
        )}
      </div>

      {err && (
        <div style={{ background: "#fef2f2", color: "#b91c1c", fontSize: 13, padding: "10px 12px", borderRadius: 8 }}>{err}</div>
      )}

      <button type="submit" disabled={busy}
        style={{ justifySelf: "start", background: busy ? "#7ca7c4" : "#0b5c8f", color: "#fff", border: "none",
          borderRadius: 8, padding: "12px 28px", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Sending…" : "Submit request"}
      </button>
    </form>
  );
}
