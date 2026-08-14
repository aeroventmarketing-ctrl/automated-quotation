"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, X, Paperclip } from "lucide-react";

export interface RfqPrefill {
  c?: string;
  t?: string;
  company?: string;
  contactName?: string;
  email?: string;
}

const MAX_FILES = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.xlsx,.xls,.csv,.doc,.docx,.ppt,.pptx,.dwg,.dxf,.zip,.rar,.7z,.txt";
const ALLOWED_EXT = new Set([
  "pdf", "jpg", "jpeg", "png", "webp", "gif", "heic",
  "xlsx", "xls", "csv", "doc", "docx", "ppt", "pptx",
  "dwg", "dxf", "zip", "rar", "7z", "txt",
]);

type Picked = { id: string; file: File; url: string };

const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#1f2933", margin: "0 0 5px" };
const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14,
  border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#1f2933",
};

function prettySize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Public RFQ submission form. Files are managed in state so the client can ADD
 * several across multiple picks (the native input replaces its selection each
 * time), preview each with the eye button, and remove any before submitting.
 * Posts multipart form-data to /api/rfq. Includes a honeypot ("website").
 */
export function RfqForm({ prefill }: { prefill: RfqPrefill }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);

  // Revoke every object URL still around when the form unmounts.
  const pickedRef = useRef<Picked[]>([]);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  useEffect(() => () => pickedRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Snapshot the picked files NOW — resetting the input below empties the live
    // FileList, and a deferred state updater would otherwise read nothing.
    const incoming = Array.from(list);
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file after removal

    const existing = pickedRef.current;
    const additions: Picked[] = [];
    let total = existing.reduce((a, p) => a + p.file.size, 0);
    let count = existing.length;
    let error: string | null = null;
    const isDup = (f: File) =>
      existing.some((p) => p.file.name === f.name && p.file.size === f.size) ||
      additions.some((p) => p.file.name === f.name && p.file.size === f.size);

    for (const f of incoming) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXT.has(ext)) { error = `"${f.name}" is not an accepted file type.`; continue; }
      if (f.size > MAX_FILE_BYTES) { error = `"${f.name}" is larger than 15 MB.`; continue; }
      if (isDup(f)) continue; // skip files already added
      if (count >= MAX_FILES) { error = `You can attach at most ${MAX_FILES} files.`; break; }
      if (total + f.size > MAX_TOTAL_BYTES) { error = "Your attachments total more than 40 MB — please remove a file."; break; }
      total += f.size;
      count++;
      additions.push({ id: String(++idRef.current), file: f, url: URL.createObjectURL(f) });
    }

    setErr(error);
    if (additions.length) setPicked((prev) => [...prev, ...additions]);
  }

  function remove(id: string) {
    setPicked((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((x) => x.id !== id);
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget); // text fields + honeypot + c/t
      for (const p of picked) fd.append("files", p.file); // files come from state, not the input
      const res = await fetch("/api/rfq", { method: "POST", body: fd });
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

  const totalBytes = picked.reduce((a, p) => a + p.file.size, 0);

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
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
        <input ref={inputRef} type="file" multiple accept={ACCEPT} onChange={(e) => addFiles(e.target.files)} style={{ display: "none" }} />
        <button type="button" onClick={() => inputRef.current?.click()}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #cbd5e1",
            borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, color: "#0b5c8f", cursor: "pointer" }}>
          <Paperclip size={16} /> {picked.length ? "Add more files" : "Choose files"}
        </button>
        <p style={{ color: "#94a3b8", fontSize: 12, margin: "6px 0 0" }}>
          PDF, images, Excel/Word, CAD (DWG/DXF) or ZIP · up to 10 files, 15&nbsp;MB each. Add as many as you need.
        </p>

        {picked.length > 0 && (
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {picked.map((p) => {
              const isImg = p.file.type.startsWith("image/");
              return (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #e2e8f0", borderRadius: 8, padding: 8 }}>
                  {isImg ? (
                    <img src={p.url} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #e2e8f0" }} />
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 6, background: "#f1f5f9", color: "#64748b" }}>
                      <Paperclip size={18} />
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, color: "#1f2933", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.file.name}</span>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{prettySize(p.file.size)}</span>
                  </span>
                  <a href={p.url} target="_blank" rel="noreferrer" title="Preview" aria-label={`Preview ${p.file.name}`}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 6, border: "1px solid #e2e8f0", color: "#0b5c8f", textDecoration: "none" }}>
                    <Eye size={16} />
                  </a>
                  <button type="button" onClick={() => remove(p.id)} title="Remove" aria-label={`Remove ${p.file.name}`}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#dc2626", cursor: "pointer" }}>
                    <X size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {picked.length > 0 && (
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0" }}>
            {picked.length} file{picked.length === 1 ? "" : "s"} · {prettySize(totalBytes)} total
          </p>
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
