"use client";

import { useState } from "react";
import { Plus, Upload, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNextControlFlowError } from "@/lib/utils";
import type { SaleDoc } from "@/lib/sale";
import { addQuotation, ensureInquiryForQuotation } from "../actions";

/**
 * "Add quotation" control. Sales must attach the RFQ / BOQ before a quotation
 * can be created; the button opens a small panel that requires the upload, then
 * creates the DRAFT quote (the server redirects to the builder).
 */
export function AddQuotation({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<SaleDoc | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File) {
    setUploading(true);
    setErr(null);
    try {
      // File under the real inquiry the quote will attach to, so document
      // view-access (owner check by path) resolves correctly.
      const inquiryId = await ensureInquiryForQuotation(customerId);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("inquiryId", inquiryId);
      const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Upload failed"); return; }
      setDoc(data as SaleDoc);
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setErr("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!doc) { setErr("Attach the RFQ / BOQ first."); return; }
    setBusy(true);
    setErr(null);
    try {
      await addQuotation(customerId, doc);
      // server redirects to the new quotation builder
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setErr(e instanceof Error ? e.message : "Failed to add quotation");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add quotation
      </Button>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-2 rounded-md border bg-muted/30 p-3 text-left sm:w-80">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Add quotation</span>
        <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Attach the RFQ / BOQ to start a quotation. It is required and files against the inquiry&apos;s documents.</p>

      {doc ? (
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm">
          <FileText className="h-4 w-4 text-primary" />
          <span className="flex-1 truncate">{doc.name}</span>
          <button type="button" onClick={() => setDoc(null)} className="text-muted-foreground hover:text-destructive" aria-label="Remove file">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload RFQ / BOQ"}
          <input type="file" className="hidden" disabled={uploading} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy || uploading || !doc} onClick={submit}>
          {busy ? "Creating…" : "Create quotation"}
        </Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
