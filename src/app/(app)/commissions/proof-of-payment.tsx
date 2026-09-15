"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, FileCheck2, X, Eye } from "lucide-react";
import { attachCommissionProof, removeCommissionProof, attachDealProof, removeDealProof } from "./actions";
import { actionError } from "@/lib/action-result";
import type { CommissionProofDoc } from "@/lib/commission-proof";

const viewHref = (d: CommissionProofDoc) =>
  `/api/commission-uploads?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;

/**
 * The attached slips, as links.
 *
 * Shown to whoever may open them, which is the three finance seats **and the
 * salesperson the payout pays** — the owner's requirement, and the reason the
 * route behind these links checks the payee's id rather than a role. A payee with
 * nothing attached sees the sentence saying so, because "no proof yet" is the
 * thing they would otherwise have to ask about.
 */
export function ProofList({
  docs,
  salespersonId,
  canAttach = false,
  emptyNote,
}: {
  docs: CommissionProofDoc[];
  salespersonId: string;
  canAttach?: boolean;
  emptyNote?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(path: string) {
    setBusy(path);
    setErr(null);
    const refusal = actionError(await removeCommissionProof(salespersonId, path).catch(() => null));
    if (refusal) setErr(refusal);
    else router.refresh();
    setBusy(null);
  }

  if (docs.length === 0) {
    return emptyNote ? <span className="text-[10px] text-muted-foreground">{emptyNote}</span> : null;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {docs.map((d) => (
        <span key={d.path} className="inline-flex items-center gap-1">
          <a
            href={viewHref(d)}
            target="_blank"
            rel="noopener noreferrer"
            title={d.uploadedByName ? `Attached by ${d.uploadedByName}` : undefined}
            className="inline-flex items-center gap-1 rounded border border-emerald-600/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
          >
            <FileCheck2 className="h-3 w-3" />
            {d.name}
          </a>
          {canAttach && (
            <button
              type="button"
              disabled={busy === d.path}
              onClick={() => remove(d.path)}
              title="Remove this proof"
              className="text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </span>
  );
}

/**
 * Attach a slip to one salesperson's payout. Accounting, the Payment Approver or
 * an admin — the same three the server checks, twice: once on the upload route
 * that stores the file and once on the action that records it.
 */
export function AttachProof({ salespersonId, salespersonName }: { salespersonId: string; salespersonName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("salespersonId", salespersonId);
      const res = await fetch("/api/commission-uploads", { method: "POST", body: form });
      const data = (await res.json()) as { error?: string; path?: string; name?: string; uploadedAt?: string; uploadedById?: string; uploadedByName?: string };
      if (!res.ok || !data.path) { setErr(data.error ?? "Upload failed."); return; }
      const refusal = actionError(await attachCommissionProof(salespersonId, {
        path: data.path,
        name: data.name ?? file.name,
        uploadedAt: data.uploadedAt ?? new Date().toISOString(),
        uploadedById: data.uploadedById ?? "",
        uploadedByName: data.uploadedByName ?? "",
      }));
      if (refusal) { setErr(refusal); return; }
      router.refresh();
    } catch {
      setErr("Couldn't attach the proof. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        title={`Attach the deposit slip or transfer screenshot for ${salespersonName}`}
        className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        <Paperclip className="h-3.5 w-3.5" />
        {busy ? "Attaching…" : "Proof of payment"}
      </button>
      {err && <span className="max-w-[18rem] text-right text-[10px] leading-tight text-destructive">{err}</span>}
    </span>
  );
}

/**
 * The eye in the Action column: this row's proof of payment.
 *
 * The owner: *"put an eye view at action column, when eye view is clicked, proof
 * of payment can be viewed. Put the proof of payment or signed voucher on the
 * corresponding row or client where the commission is paid."*
 *
 * Both halves of that sentence live here. The eye OPENS what is attached — shown
 * to the three finance seats and to the salesperson the row pays, which is the
 * requirement from the day before. And for those three seats the same panel
 * ATTACHES, one row at a time, so a slip can go on the exact commission it
 * evidences — including one the payee has already signed for, which the
 * payout-level attach deliberately leaves alone.
 *
 * The eye carries a dot when something is attached, so a row with evidence can be
 * told from one without at a glance, without opening anything.
 */
export function RowProof({
  kind,
  refId,
  payeeKind,
  salespersonId,
  docs,
  canAttach = false,
}: {
  kind: "order" | "counter";
  refId: string;
  payeeKind: "base" | "override";
  salespersonId: string;
  docs: CommissionProofDoc[];
  canAttach?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("salespersonId", salespersonId);
      const res = await fetch("/api/commission-uploads", { method: "POST", body: form });
      const data = (await res.json()) as { error?: string; path?: string; name?: string; uploadedAt?: string; uploadedById?: string; uploadedByName?: string };
      if (!res.ok || !data.path) { setErr(data.error ?? "Upload failed."); return; }
      const refusal = actionError(await attachDealProof(kind, refId, payeeKind, {
        path: data.path,
        name: data.name ?? file.name,
        uploadedAt: data.uploadedAt ?? new Date().toISOString(),
        uploadedById: data.uploadedById ?? "",
        uploadedByName: data.uploadedByName ?? "",
      }));
      if (refusal) { setErr(refusal); return; }
      router.refresh();
    } catch {
      setErr("Couldn't attach the proof. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function drop(path: string) {
    setBusy(true);
    setErr(null);
    const refusal = actionError(await removeDealProof(kind, refId, payeeKind, path).catch(() => null));
    if (refusal) setErr(refusal);
    else router.refresh();
    setBusy(false);
  }

  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={docs.length > 0 ? `Proof of payment (${docs.length})` : "Proof of payment — none attached yet"}
        aria-label="View proof of payment"
        className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border hover:bg-accent"
      >
        <Eye className={`h-3.5 w-3.5 ${docs.length > 0 ? "text-emerald-600" : "text-muted-foreground"}`} />
        {docs.length > 0 && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      </button>

      {open && (
        // A centred overlay rather than a popover hung off the button, for two
        // reasons found by looking at it:
        //
        //  · it was drawn with `bg-popover`, and this project's CSS defines
        //    `--card` but has never defined `--popover` — so the panel had NO
        //    background and the rows behind read straight through it;
        //  · and the commissions table sits in an `overflow-x-auto` wrapper, which
        //    clips anything hanging out of it. The attach button was cut in half.
        //
        // Fixed positioning escapes the scroll container, the backdrop makes the
        // text unambiguous, and there is no z-index race with the row badges.
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/30"
          />
          <div className="relative w-full max-w-sm rounded-lg border bg-card p-4 text-left text-card-foreground shadow-xl">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Proof of payment</p>
          {docs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {canAttach ? "Nothing attached yet. Add the slip or the signed voucher below." : "Nothing attached yet — ask Accounting for the slip."}
            </p>
          ) : (
            <ul className="space-y-1">
              {docs.map((d) => (
                <li key={d.path} className="flex items-center justify-between gap-2">
                  <a
                    href={viewHref(d)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    <FileCheck2 className="h-3 w-3 flex-none" />
                    <span className="truncate">{d.name}</span>
                  </a>
                  {canAttach && (
                    <button type="button" disabled={busy} onClick={() => drop(d.path)} title="Remove" className="flex-none text-muted-foreground hover:text-destructive disabled:opacity-50">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {docs.some((d) => d.uploadedByName) && (
            <p className="mt-2 text-[11px] text-muted-foreground">Attached by {docs.find((d) => d.uploadedByName)!.uploadedByName}</p>
          )}
          {canAttach && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => input.current?.click()}
                className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
              >
                <Paperclip className="h-3 w-3" />
                {busy ? "Attaching…" : docs.length > 0 ? "Attach another" : "Attach proof / signed voucher"}
              </button>
            </>
          )}
          {err && <p className="mt-1 text-[11px] text-destructive">{err}</p>}
          <button type="button" onClick={() => setOpen(false)} className="mt-3 w-full rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent">Close</button>
          </div>
        </div>
      )}
    </span>
  );
}
