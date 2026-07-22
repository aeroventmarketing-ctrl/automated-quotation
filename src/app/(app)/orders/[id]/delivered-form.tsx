"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SaleDoc } from "@/lib/sale";
import { saveCloseDoc, removeCloseDoc, markDelivered } from "../actions";

const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docDownload = (d: SaleDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

/** Logistics uploads the proof-of-delivery files (multiple) then marks delivered. */
export function DeliveredForm({ orderId, initialFiles }: { orderId: string; initialFiles: SaleDoc[] }) {
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
      await saveCloseDoc(orderId, "pod", data as SaleDoc);
      setFiles((fs) => [...fs, data as SaleDoc]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  async function remove(path: string) {
    setBusy(true); setErr(null);
    try {
      await removeCloseDoc(orderId, "pod", path);
      setFiles((fs) => fs.filter((x) => x.path !== path));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function deliver() {
    setBusy(true); setErr(null);
    try {
      await markDelivered(orderId, "");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Proof of delivery (signed documents / photos)</Label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {files.map((f) => (
          <div key={f.path} className="flex items-center gap-2">
            <a href={docLink(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
              <FileText className="h-4 w-4" /> {f.name}
            </a>
            <a href={docDownload(f)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
              <Download className="h-4 w-4" />
            </a>
            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(f.path)} disabled={busy} aria-label="Remove">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> {files.length ? "Add file" : "Upload"}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      <Button size="sm" disabled={busy} onClick={deliver}>{busy ? "Saving…" : "Mark Delivered"}</Button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
