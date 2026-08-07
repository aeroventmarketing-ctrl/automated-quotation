"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SaleDoc } from "@/lib/sale";
import { uploadDocument } from "@/lib/client-upload";
import { saveCloseDoc, removeCloseDoc, qaTransfer, markDelivered } from "../actions";

const docView = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const docDownload = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * Plant pick up: a Warehouseman step that attaches a document then advances.
 *  - kind "form": attach the Delivery Receipt (the delivery form) → "Make the
 *    delivery form" (qaTransfer).
 *  - kind "pod":  attach the proof of pick up → "Upload form & mark picked up"
 *    (markDelivered).
 */
export function PlantDocStep({
  orderId,
  kind,
  initialFiles,
  admin = false,
}: {
  orderId: string;
  kind: "form" | "pod";
  initialFiles: SaleDoc[];
  admin?: boolean;
}) {
  const slot = kind === "form" ? "delivery_receipt" : "pod";
  const label = kind === "form" ? "Delivery form (Delivery Receipt)" : "Proof of pick up";
  const btn = kind === "form" ? "Make delivery form" : "Upload form & proof of pick up";
  const hint = kind === "form" ? "Attach the Delivery Receipt to enable “Make delivery form”." : "Attach the proof of pick up to enable the button.";

  const router = useRouter();
  const [files, setFiles] = useState<SaleDoc[]>(initialFiles);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true); setErr(null);
    try {
      const data = await uploadDocument("/api/sale-uploads", file, { quotationId: orderId }) as SaleDoc;
      await saveCloseDoc(orderId, slot, data);
      setFiles((fs) => [...fs, data]);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  }

  async function remove(path: string) {
    setBusy(true); setErr(null);
    try {
      await removeCloseDoc(orderId, slot, path);
      setFiles((fs) => fs.filter((x) => x.path !== path));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function advance() {
    setBusy(true); setErr(null);
    try {
      if (kind === "form") await qaTransfer(orderId);
      else await markDelivered(orderId, "");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
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
            {admin && (
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(f.path)} disabled={busy} aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> {files.length ? "Add file" : "Upload"}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      <Button size="sm" disabled={busy || files.length === 0} onClick={advance}>{busy ? "Saving…" : btn}</Button>
      {files.length === 0 && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
