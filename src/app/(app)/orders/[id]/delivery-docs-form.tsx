"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { deliveryUnsignedDocTypes, type SaleDoc } from "@/lib/sale";
import { saveCloseDoc, removeCloseDoc, prepareDeliveryDocs } from "../actions";

const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docDownload = (d: SaleDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * "Prepare delivery documents" step — Accounting attaches the unsigned client
 * documents (Sales Invoice / OR-CR-AF / Delivery Receipt), records the
 * reference numbers, then approves delivery. Sales Invoice is hidden for
 * VAT-exclusive deals.
 */
export function DeliveryDocsForm({
  orderId,
  initialDocs,
  vatInclusive,
}: {
  orderId: string;
  initialDocs: Record<string, SaleDoc[]>;
  vatInclusive: boolean;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<Record<string, SaleDoc[]>>(initialDocs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const types = deliveryUnsignedDocTypes(vatInclusive);

  async function upload(key: string, file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("quotationId", orderId);
      const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await saveCloseDoc(orderId, key, data as SaleDoc);
      setDocs((d) => ({ ...d, [key]: [...(d[key] ?? []), data as SaleDoc] }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  async function remove(key: string, path: string) {
    setBusy(true); setErr(null);
    try {
      await removeCloseDoc(orderId, key, path);
      setDocs((d) => ({ ...d, [key]: (d[key] ?? []).filter((x) => x.path !== path) }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      await prepareDeliveryDocs(orderId, { dr: "", si: "", or: "" });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Prepare delivery documents</p>
        <p className="text-xs text-muted-foreground">Attach the unsigned client documents (to be signed on delivery).</p>
      </div>

      <div className="space-y-1.5">
        {types.map((t) => {
          const files = docs[t.key] ?? [];
          return (
            <div key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Label className="min-w-[13rem] text-xs">{t.label} <span className="text-muted-foreground">(unsigned)</span></Label>
              {files.map((f) => (
                <span key={f.path} className="inline-flex items-center gap-2">
                  <a href={docLink(f)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
                    <FileText className="h-4 w-4" /> {f.name}
                  </a>
                  <a href={docDownload(f)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
                    <Download className="h-4 w-4" />
                  </a>
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(t.key, f.path)} disabled={busy} aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                <Upload className="h-4 w-4" /> {files.length ? "Add file" : "Upload"}
                <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(t.key, e.target.files[0])} />
              </label>
            </div>
          );
        })}
      </div>

      <Button size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save documents & approve delivery"}</Button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
