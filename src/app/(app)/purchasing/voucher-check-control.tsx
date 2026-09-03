"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, AlertTriangle } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import { uploadDocument } from "@/lib/client-upload";
import { checkMissing, type CheckDoc } from "@/lib/voucher-check";
import type { PRStatus } from "@/lib/purchasing";
import { attachVoucherCheck, removeVoucherCheck } from "../orders/actions";

/**
 * The photo of the check issued for this PO's voucher — sitting to the right of
 * *Print PO & 2307*, where the owner asked for it: *"I would like accounting role
 * to attach or upload picture of check in this location … for future reference."*
 *
 * Three states, in the order a PO passes through them:
 *
 * 1. **nothing to say** — a cash supplier, or a PO that has not reached the
 *    signing step yet. The control renders nothing at all rather than adding a
 *    dead button to every row.
 * 2. **expected, missing** — an amber *Check not attached* badge. It is a
 *    reminder, never a gate: the owner's ruling was *"It is required, but not a
 *    gate."*
 * 3. **attached** — the file, viewable and downloadable by anyone who may see the
 *    PO, removable by the people who may attach one.
 */
export function VoucherCheckControl({
  prId,
  docs,
  status,
  supplierGivesTerms,
  canAttach,
  canView,
}: {
  prId: string;
  docs: CheckDoc[];
  status: PRStatus;
  /** The PO's supplier gives us payment terms — so a check exists to photograph. */
  supplierGivesTerms: boolean;
  /** Accounting / Payment Approver / admin. */
  canAttach: boolean;
  /** The viewer may see the supplier + PO document at all. */
  canView: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const missing = checkMissing({ supplierGivesTerms, status, docs });
  // Nothing attached and nothing expected — say nothing.
  if (docs.length === 0 && !missing && !canAttach) return null;
  if (!canView && !canAttach) return null;

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const doc = await uploadDocument("/api/purchase-uploads", file, { purchaseRequestId: prId });
      const res = await attachVoucherCheck(prId, { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt });
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(path: string, name: string) {
    if (!window.confirm(`Remove the check photo "${name}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await removeVoucherCheck(prId, path);
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {missing && (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
          title="This supplier gives us terms, so the PO is paid by check. Attach a photo of the check for future reference."
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Check not attached
        </span>
      )}
      {docs.map((d) => (
        <UploadLink
          key={d.path}
          doc={d}
          base="/api/purchase-uploads"
          size="xs"
          busy={busy}
          onRemove={canAttach ? () => remove(d.path, d.name) : undefined}
        />
      ))}
      {canAttach && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title="Attach a photo of the check issued for this PO"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          >
            <Banknote className="h-3.5 w-3.5" />
            {busy ? "Uploading…" : docs.length ? "Add check" : "Attach check"}
          </button>
        </>
      )}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
