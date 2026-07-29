"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import type { SaleDoc } from "@/lib/sale";
import type { CounterDocSlot } from "@/lib/counter-sale";
import { uploadDocument } from "@/lib/client-upload";
import { addCounterSaleDoc, removeCounterSaleDoc } from "./actions";

/**
 * Per-slot document upload for a counter sale (record-and-upload). Each slot is a
 * bucket (Sales Invoice / Collection Receipt / Delivery Receipt / Delivery Form /
 * Acknowledgement Form / BIR 2307). Anyone with access can attach; admin removes.
 */
export function CounterSaleDocs({
  saleId,
  slots,
  docs,
  canEdit,
  admin,
}: {
  saleId: string;
  slots: CounterDocSlot[];
  docs: Record<string, SaleDoc[]>;
  canEdit: boolean;
  admin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(slotKey: string, file: File) {
    setBusy(slotKey); setErr(null);
    try {
      const data = (await uploadDocument("/api/counter-sale-uploads", file, { counterSaleId: saleId })) as SaleDoc;
      await addCounterSaleDoc(saleId, slotKey, data);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(null); }
  }

  async function remove(slotKey: string, path: string) {
    setBusy(slotKey); setErr(null);
    try {
      await removeCounterSaleDoc(saleId, slotKey, path);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove");
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-2">
      {slots.map((slot) => {
        const files = docs[slot.key] ?? [];
        return (
          <div key={slot.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2">
            <span className="w-44 shrink-0 text-sm font-medium">
              {slot.label}{slot.optional && <span className="ml-1 text-[11px] font-normal text-muted-foreground">(optional)</span>}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              {files.map((f) => (
                <UploadLink
                  key={f.path}
                  doc={f}
                  base="/api/counter-sale-uploads"
                  size="xs"
                  onRemove={admin ? () => remove(slot.key, f.path) : undefined}
                />
              ))}
              {files.length === 0 && <span className="text-xs text-muted-foreground">Not attached yet.</span>}
            </div>
            {canEdit && (
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">
                <Upload className="h-3.5 w-3.5" /> {busy === slot.key ? "Uploading…" : files.length ? "Add" : "Upload"}
                <input type="file" className="hidden" disabled={busy === slot.key} onChange={(e) => { if (e.target.files?.[0]) upload(slot.key, e.target.files[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
        );
      })}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
