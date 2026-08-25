"use client";

/**
 * Closing-document reader/approver for a Sales Invoice / Collection Receipt /
 * Delivery Receipt slot. Role policy:
 *  - **Accounting (and other non-approvers):** the AI read is the required path.
 *    A freshly uploaded file is read automatically; success is announced, an
 *    error is explained, and after the 3-read limit the slot LOCKS and asks an
 *    Admin / Payment Approver to step in. They cannot accept a document by hand.
 *  - **Admin / Payment Approver:** unlimited reads, and can **Approve** a
 *    document (accept the upload regardless of the AI read) or **allow more
 *    reads** to unlock Accounting.
 *
 * Renders BELOW a slot's file list (the parent still handles upload / remove).
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Check, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { AI_SALE_DOC_READ_LIMIT } from "@/lib/ai/limits";
import { isSaleDocCleared, type SaleDoc, type SaleDocReadStamp } from "@/lib/sale";
import { approveSaleDoc, resetSaleDocReadLimit } from "../actions";

function stampStatus(s: SaleDocReadStamp, currency: string): { tone: "ok" | "bad"; text: string } {
  if (s.approved) {
    const num = s.documentNumber ? `No. ${s.documentNumber} · ` : "";
    return { tone: "ok", text: `✓ Approved by ${s.approved.byName}${s.approved.byName ? " — " : ""}${num}upload accepted.` };
  }
  const numLabel = s.documentNumber ? `No. ${s.documentNumber}` : "number not read";
  if (s.duplicateOf) return { tone: "bad", text: `⚠ ${numLabel} — already used on order ${s.duplicateOf}.` };
  if (!s.documentNumber) return { tone: "bad", text: "✗ Couldn't read the document number — try a clearer copy." };
  const amt = s.amount != null ? formatCurrency(s.amount, currency) : null;
  if (s.amountMatches === false && s.expected != null)
    return { tone: "bad", text: `⚠ ${numLabel}${amt ? ` · reads ${amt}` : ""} but the order total is ${formatCurrency(s.expected, currency)}.` };
  const parts = [numLabel];
  if (amt) parts.push(s.amountMatches ? `${amt} ✓ tallies` : amt);
  if (s.date) parts.push(s.date);
  return { tone: "ok", text: `✓ Read successfully — ${parts.join(" · ")}.` };
}

export function SaleDocReader({
  quotationId,
  docKey,
  files,
  expectedTotal,
  currency,
  initialReads,
  readsUsed,
  unlimited,
  canApprove,
  canRead,
}: {
  quotationId: string;
  docKey: string;
  files: SaleDoc[];
  expectedTotal?: number;
  currency: string;
  initialReads: Record<string, SaleDocReadStamp>;
  readsUsed: number;
  /** Admin / Payment Approver — no read limit. */
  unlimited: boolean;
  /** Admin / Payment Approver — may approve / allow-more. */
  canApprove: boolean;
  /** May run the AI reader at all (Accounting / preparer / approver). */
  canRead: boolean;
}) {
  const router = useRouter();
  const [reads, setReads] = useState<Record<string, SaleDocReadStamp>>(initialReads);
  const [status, setStatus] = useState<Record<string, { tone: "muted" | "ok" | "bad"; text: string }>>({});
  const [used, setUsed] = useState(readsUsed);
  const [readingPath, setReadingPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string>>(new Set(files.map((f) => f.path)));

  const locked = !unlimited && used >= AI_SALE_DOC_READ_LIMIT;
  const readsLeft = Math.max(0, AI_SALE_DOC_READ_LIMIT - used);

  async function read(path: string) {
    setReadingPath(path);
    setStatus((s) => ({ ...s, [path]: { tone: "muted", text: "Reading…" } }));
    try {
      const res = await fetch("/api/ai/read-sale-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId, path, docKey, expectedTotal: docKey === "delivery_receipt" ? undefined : expectedTotal }),
      });
      const j = await res.json();
      if (typeof j.reads === "number") setUsed(j.reads);
      if (res.ok) {
        const stamp: SaleDocReadStamp = {
          path, docKey,
          documentNumber: j.documentNumber ?? null,
          date: j.date ?? null,
          customerTin: j.customerTin ?? null,
          amount: typeof j.amount === "number" ? j.amount : null,
          ewtAmount: typeof j.ewtAmount === "number" ? j.ewtAmount : null,
          expected: typeof j.expected === "number" ? j.expected : null,
          amountMatches: typeof j.amountMatches === "boolean" ? j.amountMatches : null,
          duplicateOf: j.duplicateOf ?? null,
          validated: j.validated === true,
          readByName: "",
          readAt: new Date().toISOString(),
          approved: null,
        };
        setReads((m) => ({ ...m, [path]: stamp }));
        setStatus((s) => { const n = { ...s }; delete n[path]; return n; });
      } else {
        setStatus((s) => ({ ...s, [path]: { tone: "bad", text: j.error ?? "Couldn't read the document." } }));
      }
    } catch {
      setStatus((s) => ({ ...s, [path]: { tone: "bad", text: "Couldn't read the document. Try again." } }));
    } finally {
      setReadingPath(null);
    }
  }

  // Auto-read a freshly uploaded file — the AI read runs without a click for
  // whoever uploads (Accounting must pass it; an Admin / Payment Approver reads
  // then approves). Skips when Accounting is already locked at the limit.
  useEffect(() => {
    for (const f of files) {
      if (seen.current.has(f.path)) continue;
      seen.current.add(f.path);
      if (canRead && !isSaleDocCleared(reads[f.path]) && !(locked && !unlimited)) void read(f.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  async function approve(path: string) {
    setBusy(true);
    try { await approveSaleDoc(quotationId, path, docKey); router.refresh(); }
    finally { setBusy(false); }
  }
  async function allowMore() {
    setBusy(true);
    try { await resetSaleDocReadLimit(quotationId); setUsed(0); router.refresh(); }
    finally { setBusy(false); }
  }

  if (files.length === 0) return null;

  return (
    <div className="mt-0.5 space-y-1">
      {files.map((f) => {
        const stamp = reads[f.path];
        const live = status[f.path];
        const cleared = isSaleDocCleared(stamp);
        const st = live ?? (stamp ? stampStatus(stamp, currency) : null);
        const reading = readingPath === f.path;
        return (
          <div key={f.path} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {st && (
              <span className={st.tone === "ok" ? "text-emerald-600" : st.tone === "bad" ? "text-destructive" : "text-muted-foreground"}>
                {reading && <Loader2 className="mr-0.5 inline h-3 w-3 animate-spin" />}
                {st.text}
              </span>
            )}
            {canRead && !cleared && !(locked && !unlimited) && (
              <button type="button" disabled={reading || busy} onClick={() => read(f.path)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary disabled:opacity-50">
                <ScanLine className="h-3 w-3" /> {reading ? "reading…" : stamp || live ? "re-read" : "read"}{!unlimited && used > 0 ? ` (${readsLeft} left)` : ""}
              </button>
            )}
            {canApprove && !cleared && (
              <button type="button" disabled={busy} onClick={() => approve(f.path)}
                className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50">
                <Check className="h-3 w-3" /> Approve upload
              </button>
            )}
          </div>
        );
      })}
      {locked && !unlimited && files.some((f) => !isSaleDocCleared(reads[f.path])) && (
        <p className="text-[11px] font-medium text-amber-700">
          🔒 AI read limit reached ({AI_SALE_DOC_READ_LIMIT} of {AI_SALE_DOC_READ_LIMIT}). Ask an Admin / Payment Approver to approve the upload or allow more tries.
        </p>
      )}
      {canApprove && locked && (
        <button type="button" disabled={busy} onClick={allowMore} className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50">
          Allow {AI_SALE_DOC_READ_LIMIT} more AI reads
        </button>
      )}
    </div>
  );
}
