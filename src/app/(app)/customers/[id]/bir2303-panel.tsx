"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileText, Sparkles, Upload, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadDocument } from "@/lib/client-upload";
import { formatIssuedOn, type Bir2303Doc, type Bir2303Fields } from "@/lib/bir2303";
import { attachBir2303, saveBir2303 } from "../actions";

const viewHref = (doc: Bir2303Doc) => `/api/customer-uploads?path=${encodeURIComponent(doc.path)}`;
const fmtStamp = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const LABELS: { key: keyof Bir2303Fields; label: string; wide?: boolean }[] = [
  { key: "tin", label: "TIN & Branch Code" },
  { key: "tradeName", label: "Trade Name" },
  { key: "tinIssuedOn", label: "TIN Issuance Date" },
  { key: "taxpayerType", label: "Taxpayer Type" },
  { key: "registeredAddress", label: "Registered Address", wide: true },
];

/**
 * The client's BIR Form 2303 — five fields in Client details, the certificate
 * behind an eye, and an AI read that fills the boxes for a person to check and
 * save. The owner: *"Add a link wherein the sales role or accounting role can
 * upload the BIR 2303, put an eyeview and use AI reading to autofill the
 * additional fields."*
 */
export function Bir2303Panel({
  customerId,
  fields,
  doc,
  updatedByName,
  updatedAt,
  canView,
  canEdit,
}: {
  customerId: string;
  fields: Bir2303Fields;
  doc: Bir2303Doc | null;
  updatedByName?: string;
  updatedAt?: string;
  canView: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Bir2303Fields>(fields);
  const [busy, setBusy] = useState<null | "upload" | "read" | "save">(null);
  const [err, setErr] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string[] | null>(null);

  const startEdit = (values: Bir2303Fields = fields) => {
    setForm(values);
    setEditing(true);
  };

  async function readWithAi() {
    setBusy("read");
    setErr(null);
    try {
      const res = await fetch("/api/ai/read-bir2303", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { fields?: Bir2303Fields; warnings?: string[]; remaining?: number | null; error?: string }
        | null;
      if (!res.ok || !data?.fields) {
        // Still open the form: the person can type it from the certificate.
        setErr(data?.error ?? "The AI read failed — type the fields from the certificate.");
        startEdit(editing ? form : fields);
        return;
      }
      // Fill only what was read; a box the AI left empty keeps what was there.
      const base = editing ? form : fields;
      const read = data.fields;
      startEdit({
        tin: read.tin || base.tin,
        tradeName: read.tradeName || base.tradeName,
        tinIssuedOn: read.tinIssuedOn || base.tinIssuedOn,
        taxpayerType: read.taxpayerType || base.taxpayerType,
        registeredAddress: read.registeredAddress || base.registeredAddress,
      });
      const left = data.remaining;
      setAiNote([
        ...(data.warnings ?? []),
        ...(left != null ? [`${left} AI read${left === 1 ? "" : "s"} left for this file.`] : []),
      ]);
    } catch {
      setErr("The AI read failed — type the fields from the certificate.");
      startEdit(editing ? form : fields);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    setErr(null);
    setAiNote(null);
    try {
      const up = await uploadDocument("/api/customer-uploads", file, { customerId });
      await attachBir2303(customerId, up);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      setBusy(null);
      return;
    }
    // Straight into the read — uploading it is asking for the fields.
    await readWithAi();
  }

  async function save() {
    setBusy("save");
    setErr(null);
    try {
      await saveBir2303(customerId, form);
      setEditing(false);
      setAiNote(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  }

  const uploadLink = (text: string) => (
    <label className={`inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-primary hover:underline ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <Upload className="h-3.5 w-3.5" />
      {busy === "upload" ? "Uploading…" : text}
      <input
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        disabled={!!busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f);
        }}
      />
    </label>
  );

  const shown = (k: keyof Bir2303Fields) => (k === "tinIssuedOn" ? formatIssuedOn(fields.tinIssuedOn) : fields[k]);

  return (
    <div className="space-y-3 border-t pt-4 sm:col-span-2" data-testid="bir2303">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">BIR 2303 · Certificate of Registration</div>
        <div className="flex flex-wrap items-center gap-3">
          {doc ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              {canView ? (
                <>
                  <a href={viewHref(doc)} target="_blank" rel="noopener noreferrer" className="max-w-[14rem] truncate font-medium text-primary hover:underline" title={doc.name}>
                    {doc.name}
                  </a>
                  <a href={viewHref(doc)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View the BIR 2303" aria-label="View the BIR 2303">
                    <Eye className="h-4 w-4" />
                  </a>
                </>
              ) : (
                <span className="text-muted-foreground">BIR 2303 on file</span>
              )}
            </span>
          ) : (
            !canEdit && <span className="text-xs text-muted-foreground">No BIR 2303 uploaded</span>
          )}
          {canEdit && uploadLink(doc ? "Replace" : "Upload BIR 2303")}
          {canEdit && doc && (
            <button type="button" onClick={readWithAi} disabled={!!busy} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-60">
              <Sparkles className="h-3.5 w-3.5" />
              {busy === "read" ? "Reading…" : "Read with AI"}
            </button>
          )}
          {canEdit && !editing && (
            <button type="button" onClick={() => startEdit()} disabled={!!busy} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          {aiNote && (
            <div className="rounded-md bg-primary/5 px-3 py-2 text-xs">
              <p className="font-medium">Filled in by AI — check each field against the certificate{doc && canView ? " (the eye above)" : ""}, then Save.</p>
              {aiNote.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {aiNote.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {LABELS.map(({ key, label, wide }) => (
              <label key={key} className={`space-y-1 text-xs text-muted-foreground ${wide ? "sm:col-span-2" : ""}`}>
                <span>{label}</span>
                <Input
                  className="h-9 text-sm text-foreground"
                  type={key === "tinIssuedOn" ? "date" : "text"}
                  value={form[key]}
                  placeholder={key === "tin" ? "e.g. 201-616-609-00000" : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setAiNote(null); setErr(null); }} disabled={!!busy}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {LABELS.map(({ key, label, wide }) => (
            <div key={key} className={wide ? "sm:col-span-2" : ""}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-sm font-medium">{shown(key) || "—"}</div>
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
      {!editing && updatedByName && (
        <p className="text-[11px] text-muted-foreground">Last saved by {updatedByName}{updatedAt ? ` · ${fmtStamp(updatedAt)}` : ""}</p>
      )}
    </div>
  );
}
