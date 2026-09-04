"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, AlertTriangle, ScanLine, CheckCircle2 } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import { uploadDocument } from "@/lib/client-upload";
import { formatDate } from "@/lib/utils";
import { checkAmountAgreed, checkMissing, formatCheckNo, type CheckDoc } from "@/lib/voucher-check";
import type { PRStatus } from "@/lib/purchasing";
import { attachVoucherCheck, removeVoucherCheck } from "../orders/actions";

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The photo of the check issued for this PO's voucher — sitting to the right of
 * *Print PO & 2307*, where the owner asked for it, with the **check number
 * underneath** so a PO can be found by the check that paid it.
 *
 * Uploading runs the AI reader (`/api/ai/read-check`) straight away: the reader
 * is what turns a photo into a check NUMBER, and a number nobody has to type is
 * the whole point. A failed read never loses the photo — the file is attached
 * first, read second, and "Read check" re-runs it.
 *
 * Three states, in the order a PO passes through them:
 *
 * 1. **nothing to say** — a cash supplier, or a PO that has not reached the
 *    signing step yet. The control renders nothing rather than adding a dead
 *    button to every row.
 * 2. **expected, missing** — an amber *Check not attached* badge. A reminder,
 *    never a gate: the owner's ruling was *"It is required, but not a gate."*
 * 3. **attached** — the file, the check number, and anything the read disagreed
 *    with the PO about.
 */
export function VoucherCheckControl({
  prId,
  docs,
  status,
  supplierGivesTerms,
  canAttach,
  canView,
  netAmount,
}: {
  prId: string;
  docs: CheckDoc[];
  status: PRStatus;
  /** The PO's supplier gives us payment terms — so a check exists to photograph. */
  supplierGivesTerms: boolean;
  /**
   * Accounting / Payment Approver / admin, AND the PO is in the window where a
   * check may be attached (`checkAttachableAt` — Budgeted, not yet completed).
   * When false the check is still shown; only the controls go.
   */
  canAttach: boolean;
  /** The viewer may see the supplier + PO document at all. */
  canView: boolean;
  /**
   * The PO's NET — the third figure in the tally. Omitted where the caller has
   * no PO to compare against, in which case the confirmation is simply not
   * shown; a green "tallies" with nothing behind it would be worse than none.
   */
  netAmount?: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const missing = checkMissing({ supplierGivesTerms, status, docs });
  // Nothing attached and nothing expected — say nothing.
  if (docs.length === 0 && !missing && !canAttach) return null;
  if (!canView && !canAttach) return null;
  // Read-only: the check, its number and its details still show — the owner's
  // *"checks can always be viewed"* — but nothing here can change them.
  const readOnly = !canAttach;

  /** Read one attached photo. Never throws away the file on failure. */
  async function read(path: string): Promise<string | null> {
    const res = await fetch("/api/ai/read-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseRequestId: prId, path }),
    });
    const data = (await res.json().catch(() => null)) as { error?: string; read?: { checkNo?: string | null } } | null;
    if (!res.ok) return data?.error ?? "The check was attached but couldn't be read.";
    setNote(data?.read?.checkNo ? `Read check No. ${formatCheckNo(data.read.checkNo)}.` : "The check was read.");
    return null;
  }

  async function upload(file: File) {
    setBusy("upload");
    setErr(null);
    setNote(null);
    try {
      const doc = await uploadDocument("/api/purchase-uploads", file, { purchaseRequestId: prId });
      const res = await attachVoucherCheck(prId, { path: doc.path, name: doc.name, uploadedAt: doc.uploadedAt });
      if (res.error) { setErr(res.error); return; }
      // Attached — from here a read failure is a warning, not a lost upload.
      setBusy("read");
      const readErr = await read(doc.path);
      if (readErr) setErr(readErr);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function reread(path: string) {
    setBusy(`read:${path}`);
    setErr(null);
    setNote(null);
    try {
      const readErr = await read(path);
      if (readErr) setErr(readErr);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the check.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(path: string, name: string) {
    if (!window.confirm(`Remove the check photo "${name}"?`)) return;
    setBusy(`del:${path}`);
    setErr(null);
    try {
      const res = await removeVoucherCheck(prId, path);
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove the file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        {missing && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
            title={
              readOnly
                ? "This supplier gives us terms, so the PO was paid by check — but no photo of it was ever attached. It can only be attached while the PO is in Budgeted."
                : "This supplier gives us terms, so the PO is paid by check. Attach a photo of the check for future reference."
            }
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Check not attached
          </span>
        )}
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
              disabled={busy != null}
              onClick={() => fileRef.current?.click()}
              title="Attach a photo of the check issued for this PO — it is read automatically"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
            >
              <Banknote className="h-3.5 w-3.5" />
              {busy === "upload" ? "Uploading…" : busy === "read" ? "Reading check…" : docs.length ? "Add check" : "Attach check"}
            </button>
          </>
        )}
      </span>

      {/* Underneath: one line per attached check — its number, then the file. */}
      {docs.map((d) => {
        const r = d.read;
        const reading = busy === `read:${d.path}`;
        const agreed = checkAmountAgreed(r, netAmount ?? 0);
        return (
          <span key={d.path} className="inline-flex flex-col items-start gap-0.5 text-xs">
            <span className="inline-flex flex-wrap items-center gap-2">
              {r?.checkNo ? (
                <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-foreground" title="Check number — searchable in the box above">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Check No. {formatCheckNo(r.checkNo)}
                </span>
              ) : (
                <span className="text-muted-foreground">Check number not read</span>
              )}
              {!r && !canAttach && (
                // The read is gone with the button — say so, rather than leaving
                // a permanent "not read" nobody on this screen can act on.
                <span className="text-muted-foreground">· can no longer be read here (the PO is completed)</span>
              )}
              <UploadLink
                doc={d}
                base="/api/purchase-uploads"
                size="xs"
                busy={busy != null}
                onRemove={canAttach ? () => remove(d.path, d.name) : undefined}
              />
              {canAttach && (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => reread(d.path)}
                  title="Read this check again"
                  className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-primary hover:underline disabled:opacity-50"
                >
                  <ScanLine className="h-3.5 w-3.5" /> {reading ? "Reading…" : r ? "Re-read" : "Read check"}
                </button>
              )}
            </span>
            {r && (r.amount != null || r.clearingYMD || r.payee) && (
              <span className="text-muted-foreground">
                {r.payee ? `${r.payee} · ` : ""}
                {r.amount != null ? `₱${peso(r.amount)}` : ""}
                {r.clearingYMD ? ` · clears ${formatDate(r.clearingYMD)}` : ""}
              </span>
            )}
            {/* What the read disagreed with the PO about. Reported, never enforced. */}
            {(r?.issues ?? []).map((i) => (
              <span key={i.key} className="inline-flex items-start gap-1 text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {i.message}
              </span>
            ))}
            {/* …and, when the three figures agree, said out loud. Silence used to
                mean both "they tally" and "nobody looked". */}
            {/* Why the last read failed. Kept on the check itself, so it is still
                here after the page moves on — and after the PO completes. */}
            {!r && d.readError && (
              <span className="inline-flex items-start gap-1 text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Last read failed: {d.readError.message}
                {d.readError.byName ? ` (tried by ${d.readError.byName})` : ""}
              </span>
            )}
            {agreed && (
              <span className="inline-flex items-start gap-1 text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> {agreed}
              </span>
            )}
          </span>
        );
      })}

      {note && <span className="text-xs text-emerald-700">{note}</span>}
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
