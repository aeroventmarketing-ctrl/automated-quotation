"use client";

import { useState } from "react";
import { Upload, Trash2, FileText, Download, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INQUIRY_DOC_TYPES } from "@/lib/inquiry-docs";
import type { SaleDoc } from "@/lib/sale";
import { saveInquiryDocs } from "../actions";

const link = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const view = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const download = (d: SaleDoc) => `${link(d)}&download=1&name=${encodeURIComponent(d.name)}`;

/** Attach the required pre-quotation documents (Inquiry Form, RFQ/BOQ) to an inquiry. */
export function InquiryDocsUploader({
  inquiryId,
  docs,
  onChange,
  canEdit,
}: {
  inquiryId: string;
  docs: Record<string, SaleDoc[]>;
  onChange: (docs: Record<string, SaleDoc[]>) => void;
  canEdit: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function persist(next: Record<string, SaleDoc[]>) {
    onChange(next);
    try { await saveInquiryDocs(inquiryId, next); } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
  }
  async function onFile(key: string, file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("inquiryId", inquiryId);
      const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Upload failed"); return; }
      await persist({ ...docs, [key]: [...(docs[key] ?? []), data as SaleDoc] });
    } finally {
      setBusy(false);
    }
  }
  function remove(key: string, path: string) {
    persist({ ...docs, [key]: (docs[key] ?? []).filter((d) => d.path !== path) });
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Documents (required before quotation)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Attach the Inquiry Form and RFQ / BOQ. Both are required before a quotation can be created; they carry over to the quotation&apos;s Sale &amp; payment documents.</p>
        {INQUIRY_DOC_TYPES.map((t) => {
          const files = docs[t.key] ?? [];
          return (
            <div key={t.key} className="space-y-1">
              <div className="text-xs font-medium">{t.label} <span className="text-muted-foreground">(required)</span></div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {files.map((f) => (
                  <div key={f.path} className="flex items-center gap-2">
                    <a href={view(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                      <FileText className="h-4 w-4" /> {f.name}
                    </a>
                    <a href={view(f)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View"><Eye className="h-4 w-4" /></a>
                    <a href={download(f)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download"><Download className="h-4 w-4" /></a>
                    {canEdit && (
                      <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(t.key, f.path)} disabled={busy} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
                {canEdit ? (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                    <Upload className="h-4 w-4" /> {files.length ? "Add file" : "Upload"}
                    <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(t.key, e.target.files[0])} />
                  </label>
                ) : files.length === 0 ? (
                  <span className="text-sm text-muted-foreground">Not attached.</span>
                ) : null}
              </div>
            </div>
          );
        })}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
