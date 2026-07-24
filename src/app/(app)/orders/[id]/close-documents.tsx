"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { afterPaymentDocTypes, closeDocsState, type SaleDoc } from "@/lib/sale";
import { saveCloseDoc, removeCloseDoc, fileDocuments } from "../actions";

const docLink = (d: SaleDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docView = (d: SaleDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const docDownload = (d: SaleDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

/**
 * Closing documents on the order card — the same after-payment slots as the
 * quotation's Sale panel (uploads reflect on both). Required slots are accented
 * light red until attached; the close button unlocks only once they're in.
 */
export function CloseDocuments({
  orderId,
  initialDocs,
  vatInclusive,
  canEdit,
  canFile,
  admin = false,
  closed = false,
}: {
  orderId: string;
  initialDocs: Record<string, SaleDoc[]>;
  vatInclusive: boolean;
  canEdit: boolean;
  canFile: boolean;
  admin?: boolean;
  /** The order already closed but its documents are still incomplete. */
  closed?: boolean;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<Record<string, SaleDoc[]>>(initialDocs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const types = afterPaymentDocTypes(vatInclusive);
  const state = closeDocsState(docs, vatInclusive);

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
    } finally {
      setBusy(false);
    }
  }

  async function remove(key: string, path: string) {
    setBusy(true); setErr(null);
    try {
      await removeCloseDoc(orderId, key, path);
      setDocs((d) => ({ ...d, [key]: (d[key] ?? []).filter((x) => x.path !== path) }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true); setErr(null);
    try {
      await fileDocuments(orderId);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!closed && (
        <div>
          <p className="text-sm font-medium">File documents &amp; close order</p>
          <p className="text-xs text-muted-foreground">Accounting files all delivery documents; the order is closed and the sales commission is computed.</p>
        </div>
      )}

      <div className="space-y-3">
        {types.map((t) => {
          const files = docs[t.key] ?? [];
          const empty = files.length === 0;
          return (
            <div key={t.key} className="space-y-1">
              <Label className="text-xs">
                {t.label} <span className="text-muted-foreground">(required)</span>
              </Label>
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
                      <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(t.key, f.path)} disabled={busy} aria-label="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                {canEdit ? (
                  <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${empty ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100" : "hover:bg-accent"}`}>
                    <Upload className="h-4 w-4" /> {empty ? "Upload" : "Add file"}
                    <input type="file" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(t.key, e.target.files[0])} />
                  </label>
                ) : empty ? (
                  <span className="text-sm text-muted-foreground">Not attached.</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Close button. Pre-close: hidden until the required docs are uploaded,
          then green (complete) or amber (BIR 2307 missing). Already closed &
          incomplete: always the amber "incomplete" affordance. */}
      {closed ? (
        state.complete ? (
          <p className="text-xs text-emerald-600">Documents complete — finalizing…</p>
        ) : canFile ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={busy} onClick={close} className="bg-amber-500 text-white hover:bg-amber-600">
              {busy ? "Saving…" : "File Documents-Close Order (Incomplete)"}
            </Button>
            <p className="max-w-md text-xs text-muted-foreground">
              <span className="font-medium text-amber-700">Closing documents — incomplete.</span>{" "}
              {state.bir2307Missing ? "BIR 2307 is not yet uploaded. " : ""}
              The order is closed but its documents are incomplete. Upload the remaining documents to complete it and release the sales commission.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Awaiting Accounting to complete the closing documents.</p>
        )
      ) : !state.appear ? (
        <p className="text-xs text-muted-foreground">Upload the required documents above to close the order.</p>
      ) : canFile ? (
        <div className="space-y-1">
          {state.bir2307Missing && (
            <p className="text-xs font-medium text-amber-700">Marked incomplete — BIR 2307 not yet uploaded.</p>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={close}
            className={state.complete ? undefined : "bg-amber-500 text-white hover:bg-amber-600"}
          >
            {busy ? "Saving…" : state.complete ? "File Documents-Close Order" : "File Documents-Close Order (Incomplete)"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Awaiting Accounting to file the documents.</p>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
