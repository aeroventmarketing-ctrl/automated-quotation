"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, FileText, Download, Eye } from "lucide-react";
import { Label } from "@/components/ui/label";
import type { SaleDoc } from "@/lib/sale";
import { saveCloseDoc, removeCloseDoc } from "../actions";

const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docView = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const docDownload = (d: SaleDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * Proof of the final payment, uploaded during the final-payment review so the
 * approver can check it before confirming. Stored under "final_payment"; once
 * the payment is confirmed it graduates into the order's Documents box and the
 * quotation's Sale panel.
 */
export function FinalPaymentProof({
  orderId,
  initialFiles,
  canEdit,
}: {
  orderId: string;
  initialFiles: SaleDoc[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<SaleDoc[]>(initialFiles);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("quotationId", orderId);
      const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await saveCloseDoc(orderId, "final_payment", data as SaleDoc);
      setFiles((fs) => [...fs, data as SaleDoc]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  async function remove(path: string) {
    setBusy(true); setErr(null);
    try {
      await removeCloseDoc(orderId, "final_payment", path);
      setFiles((fs) => fs.filter((x) => x.path !== path));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-1 rounded-md border bg-muted/20 p-3">
      <Label className="text-xs">Final payment proof <span className="text-muted-foreground">(for the approver&apos;s review)</span></Label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {files.map((f) => (
          <div key={f.path} className="flex items-center gap-2">
            <a href={docView(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
              <FileText className="h-4 w-4" /> {f.name}
            </a>
            <a href={docView(f)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
              <Eye className="h-4 w-4" />
            </a>
            <a href={docDownload(f)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
              <Download className="h-4 w-4" />
            </a>
            {canEdit && (
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(f.path)} disabled={busy} aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {canEdit ? (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" /> {files.length ? "Add file" : "Upload"}
            <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        ) : files.length === 0 ? (
          <span className="text-sm text-muted-foreground">Not attached yet.</span>
        ) : null}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
