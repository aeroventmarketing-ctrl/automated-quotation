"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, AlertTriangle, ScanLine, CheckCircle2, Pencil } from "lucide-react";
import { UploadLink } from "@/components/upload-link";
import { uploadDocument } from "@/lib/client-upload";
import { formatDate } from "@/lib/utils";
import {
  checkAmountAgreed, checkMissing, formatCheckNo, printedClearingYMD, checkReadsLeft,
  effectiveCheckAmount, effectiveCheckNo, issueApproved,
  type CheckDoc,
} from "@/lib/voucher-check";
import { AI_CHECK_READ_LIMIT } from "@/lib/ai/limits";
import type { PRStatus } from "@/lib/purchasing";
import { attachVoucherCheck, removeVoucherCheck, correctCheckRead, approveCheckDiscrepancy, unapproveCheckDiscrepancy } from "../orders/actions";

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
  canRead,
  canRemove,
  unlimitedReads = false,
  canApproveIssue = false,
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
  /**
   * The viewer may run the AI read. Wider than `canAttach`: an admin may
   * re-read at any stage, including a completed PO — reading fills in what the
   * photo already says. Defaults to `canAttach` for callers that don't say.
   */
  canRead?: boolean;
  /**
   * The viewer may DELETE the photo. Wider than `canAttach` in the same way
   * reading is: an admin may remove a wrong photo from a completed PO, which
   * would otherwise be a permanent mistake. Defaults to `canAttach`.
   */
  canRemove?: boolean;
  /**
   * This viewer's AI reads are not counted — an admin or the Payment Approver.
   * Everyone else gets `AI_CHECK_READ_LIMIT` tries per attached photo, and has
   * to be told before the button disappears on them.
   */
  unlimitedReads?: boolean;
  /**
   * The viewer may ACCEPT what the read disagreed about, or correct a misread
   * figure — an admin or the Payment Approver.
   *
   * Deliberately not gated on `canAttach`: a discrepancy on a completed PO is
   * exactly the kind still worth answering, and a check nobody may correct once
   * the PO closes is a wrong figure on the record for good.
   */
  canApproveIssue?: boolean;
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
  /** Which check's correction form is open, and what is typed in it. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ amount: string; checkNo: string; ymd: string }>({ amount: "", checkNo: "", ymd: "" });

  const mayRead = canRead ?? canAttach;
  const mayRemove = canRemove ?? canAttach;
  const missing = checkMissing({ supplierGivesTerms, status, docs });
  // Nothing attached and nothing expected — say nothing.
  if (docs.length === 0 && !missing && !canAttach && !mayRead && !mayRemove) return null;
  if (!canView && !canAttach && !mayRead && !mayRemove) return null;
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

  /** Open the correction form pre-filled with what the check currently says. */
  function openEdit(d: CheckDoc) {
    setEditing(d.path);
    setErr(null);
    setNote(null);
    // Pre-filled, not blank: most corrections change ONE of the three, and
    // retyping the two that were right is how a good figure gets broken.
    setForm({
      amount: effectiveCheckAmount(d) != null ? String(effectiveCheckAmount(d)) : "",
      checkNo: effectiveCheckNo(d) ?? "",
      ymd: printedClearingYMD(d) ?? "",
    });
  }

  async function saveEdit(path: string) {
    setBusy(`fix:${path}`);
    setErr(null);
    setNote(null);
    try {
      const amount = form.amount.trim() === "" ? null : Number(form.amount.replace(/,/g, ""));
      if (amount !== null && !Number.isFinite(amount)) { setErr("The amount isn't a number."); return; }
      const res = await correctCheckRead(prId, path, {
        amount,
        checkNo: form.checkNo.trim() || null,
        ymd: form.ymd || null,
      });
      if (res.error) { setErr(res.error); return; }
      setEditing(null);
      setNote("Check corrected.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the correction.");
    } finally {
      setBusy(null);
    }
  }

  async function approve(path: string) {
    setBusy(`ok:${path}`);
    setErr(null);
    setNote(null);
    try {
      const res = await approveCheckDiscrepancy(prId, path);
      if (res.error) { setErr(res.error); return; }
      setNote("Discrepancy approved.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not approve it.");
    } finally {
      setBusy(null);
    }
  }

  async function unapprove(path: string) {
    setBusy(`ok:${path}`);
    setErr(null);
    setNote(null);
    try {
      const res = await unapproveCheckDiscrepancy(prId, path);
      if (res.error) { setErr(res.error); return; }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not withdraw the approval.");
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
                ? "This supplier gives us terms, so the PO was paid by check — but no photo of it was ever attached. On a completed PO only Accounting, the Payment Approver or an admin can attach one now."
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
        // What the check says, a person's correction included — otherwise this
        // card goes on quoting the misread date the register has already fixed.
        const clears = printedClearingYMD(d);
        // *"3 tries in every row or every attachment"* — this photo's, not the
        // PO's. Null for the two who have no limit.
        const left = checkReadsLeft(d, { unlimited: unlimitedReads });
        // A person's correction beats the reading, here exactly as it does in
        // the register. Quoting `read.amount` straight left this card printing
        // ₱14,814.07 under a register that had already been corrected to
        // ₱14,866.07 — one check, two figures, which is the whole failure these
        // accessors exist to prevent.
        const shownAmount = effectiveCheckAmount(d);
        const shownNo = effectiveCheckNo(d);
        return (
          <span key={d.path} className="inline-flex flex-col items-start gap-0.5 text-xs">
            <span className="inline-flex flex-wrap items-center gap-2">
              {shownNo ? (
                <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-foreground" title="Check number — searchable in the box above">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Check No. {formatCheckNo(shownNo)}
                </span>
              ) : (
                <span className="text-muted-foreground">Check number not read</span>
              )}
              {!r && !mayRead && (
                // No read, and no button to run one — say so, rather than
                // leaving a permanent "not read" nobody here can act on.
                <span className="text-muted-foreground">· not readable here — ask Accounting, the Payment Approver or an admin</span>
              )}
              <UploadLink
                doc={d}
                base="/api/purchase-uploads"
                size="xs"
                busy={busy != null}
                onRemove={mayRemove ? () => remove(d.path, d.name) : undefined}
              />
              {mayRead && (left === null || left > 0) && (
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => reread(d.path)}
                  title={left === null ? "Read this check again" : `Read this check again — ${left} of ${AI_CHECK_READ_LIMIT} tries left on this photo`}
                  className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-primary hover:underline disabled:opacity-50"
                >
                  <ScanLine className="h-3.5 w-3.5" /> {reading ? "Reading…" : r ? "Re-read" : "Read check"}
                  {/* Counted down only once it has cost something: "3 tries
                      left" on an untouched photo is noise on every row. */}
                  {left !== null && left < AI_CHECK_READ_LIMIT && <span className="tabular-nums"> · {left} left</span>}
                </button>
              )}
              {/* The button goes rather than sitting there dead, and says why —
                  and who to ask, since two people can still read it. */}
              {mayRead && left === 0 && (
                <span className="text-muted-foreground" title={`This photo has had its ${AI_CHECK_READ_LIMIT} AI reads.`}>
                  Read {AI_CHECK_READ_LIMIT} times — check it against the photo, or ask an admin / the Payment Approver
                </span>
              )}
            </span>
            {r && (shownAmount != null || clears || r.payee) && (
              <span className="text-muted-foreground">
                {r.payee ? `${r.payee} · ` : ""}
                {shownAmount != null ? `₱${peso(shownAmount)}` : ""}
                {clears ? ` · clears ${formatDate(clears)}` : ""}
                {d.dateFix ? " (date corrected)" : ""}
              </span>
            )}
            {/* What the read disagreed with the PO about. Reported, never enforced.
                An approved one keeps its words and loses its alarm: the owner's
                ruling was that it *becomes* "approved by X", not that it goes. */}
            {(r?.issues ?? []).map((i) => {
              const ok = issueApproved(d, i.key);
              return (
                <span key={i.key} className={`inline-flex items-start gap-1 ${ok ? "text-emerald-700" : "text-amber-700"}`}>
                  {ok
                    ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                    : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
                  <span>
                    {i.message}
                    {ok && d.issueApproval && (
                      <span className="font-medium">
                        {" "}Approved by {d.issueApproval.byName || "—"}
                        {d.issueApproval.at ? ` on ${formatDate(d.issueApproval.at.slice(0, 10))}` : ""}
                        {d.issueApproval.note ? ` — ${d.issueApproval.note}` : ""}
                      </span>
                    )}
                  </span>
                </span>
              );
            })}

            {/* Accept it, or correct what the read got wrong. Admin / Payment
                Approver only, and only where there is something to answer. */}
            {canApproveIssue && (r?.issues?.length || d.amountFix || d.checkNoFix) && (
              <span className="inline-flex flex-wrap items-center gap-2">
                {r?.issues?.length ? (
                  d.issueApproval ? (
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => unapprove(d.path)}
                      className="text-muted-foreground underline-offset-2 hover:text-amber-700 hover:underline disabled:opacity-50"
                      title="Withdraw the approval — the discrepancy goes back to needing an answer."
                    >
                      Withdraw approval
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() => approve(d.path)}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-600/40 px-2 py-0.5 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      title="Accept this discrepancy as it stands. The warning stays visible and records who accepted it."
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {busy === `ok:${d.path}` ? "Approving…" : "Approve discrepancy"}
                    </button>
                  )
                ) : null}
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => (editing === d.path ? setEditing(null) : openEdit(d))}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium hover:bg-accent disabled:opacity-50"
                  title="Correct what the AI read wrongly — the amount, the check number or the date."
                >
                  <Pencil className="h-3.5 w-3.5" /> {editing === d.path ? "Cancel" : "Edit figures"}
                </button>
              </span>
            )}

            {/* The correction form. One row for the three figures a read
                produces, so a photo misread in two places is one save, not two
                trips through two different screens. */}
            {canApproveIssue && editing === d.path && (
              <span className="inline-flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="h-7 w-28 rounded-md border bg-background px-2 text-xs tabular-nums"
                    aria-label="Check amount"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Check No.</span>
                  <input
                    type="text"
                    value={form.checkNo}
                    onChange={(e) => setForm((f) => ({ ...f, checkNo: e.target.value }))}
                    className="h-7 w-32 rounded-md border bg-background px-2 text-xs tabular-nums"
                    aria-label="Check number"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Clears</span>
                  <input
                    type="date"
                    value={form.ymd}
                    onChange={(e) => setForm((f) => ({ ...f, ymd: e.target.value }))}
                    className="h-7 w-36 rounded-md border bg-background px-2 text-xs"
                    aria-label="Clearing date"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy != null}
                  onClick={() => saveEdit(d.path)}
                  className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === `fix:${d.path}` ? "Saving…" : "Save"}
                </button>
                {/* Says what a correction means here, because it is not what
                    "Move date" means — see `correctCheckDate`. */}
                <span className="w-full text-[11px] text-muted-foreground">
                  Corrects what the AI read wrongly. Nothing is rescheduled — to move a clearing date because
                  the check cannot be funded, use Check Monitoring.
                </span>
              </span>
            )}

            {/* A corrected figure, named. Not amber: it is settled. */}
            {(d.amountFix || d.checkNoFix) && (
              <span className="text-muted-foreground">
                {d.amountFix ? `Amount corrected by ${d.amountFix.byName}${d.amountFix.was != null ? ` · was ₱${peso(d.amountFix.was)}` : ""}` : ""}
                {d.amountFix && d.checkNoFix ? " · " : ""}
                {d.checkNoFix ? `Check no. corrected by ${d.checkNoFix.byName}${d.checkNoFix.was ? ` · was ${formatCheckNo(d.checkNoFix.was)}` : ""}` : ""}
              </span>
            )}
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
