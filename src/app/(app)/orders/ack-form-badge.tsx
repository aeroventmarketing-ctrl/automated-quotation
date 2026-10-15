"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { ACK_DOC_KIND_LABEL, type AckAiState, type AckCheck, type AckFile, type AckFormState } from "@/lib/ack-form";

export type AckFileRow = AckFile & { check: AckCheck | null };

/** Run the AI check on one file. Returns the stored verdict, or throws the server's message. */
export async function verifyAckFile(quotationId: string, path: string): Promise<AckCheck> {
  const res = await fetch("/api/ai/verify-ack-form", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quotationId, path }),
  });
  const j = (await res.json().catch(() => ({}))) as { check?: AckCheck; error?: string };
  if (!res.ok || !j.check) throw new Error(j.error || "The check failed.");
  return j.check;
}

const AI_TONE: Record<NonNullable<AckAiState>, string> = {
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  flagged: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  unclear: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unchecked: "bg-muted text-muted-foreground",
};

const verdictText = (c: AckCheck) =>
  c.verdict === "ack"
    ? `✓ ${c.kind ? ACK_DOC_KIND_LABEL[c.kind] : "Acknowledgement Form"}`
    : c.verdict === "not_ack"
      ? `✗ Not an Acknowledgement Form — looks like ${c.kind ? ACK_DOC_KIND_LABEL[c.kind] : "something else"}`
      : "? AI couldn't tell — check by hand";

/**
 * Under an order number on the Orders list: whether an Acknowledgement Form is
 * uploaded (signed / unsigned only) and what the AI made of each file — with a
 * "Check with AI" button for Accounting / the Payment Approver / admin.
 */
export function AckFormBadge({
  orderId,
  state,
  ai,
  files,
  canVerify,
  onChecked,
}: {
  orderId: string;
  state: AckFormState;
  ai: AckAiState;
  files: AckFileRow[];
  canVerify: boolean;
  onChecked: (path: string, check: AckCheck) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!state) return null;

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      // Unchecked (and unsure) files first; a re-check of a settled one only when asked.
      const todo = files.filter((f) => !f.check || f.check.verdict === "unclear");
      for (const f of todo.length ? todo : files) onChecked(f.path, await verifyAckFile(orderId, f.path));
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setBusy(false);
    }
  }

  const aiLabel =
    ai === "verified" ? "✓ AI: is an Acknowledgement Form"
    : ai === "flagged" ? "✗ AI: not an Acknowledgement Form"
    : ai === "unclear" ? "? AI couldn't tell"
    : "Not checked by AI";

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={state === "signed"
            ? "whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            : "whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"}
          title={state === "signed" ? "Signed Acknowledgement Form uploaded" : "Only the unsigned Acknowledgement Form is uploaded"}
        >
          {state === "signed" ? "✓ Ack. Form" : "Ack. Form · unsigned"}
        </span>
      </div>
      {ai && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${AI_TONE[ai]}`}
          title="Show what the AI found in each file"
        >
          {aiLabel}
        </button>
      )}
      {open && (
        <ul className="max-w-[16rem] space-y-1 rounded border bg-background p-1.5 text-[10px]">
          {files.map((f) => (
            <li key={f.path}>
              <div className="truncate font-medium" title={f.name}>
                {f.name}
                <span className="font-normal text-muted-foreground"> · {f.signed ? "signed" : "unsigned"}{f.batch ? ` · ${f.batch}` : ""}</span>
              </div>
              {f.check ? (
                <div className={f.check.verdict === "ack" ? "text-emerald-700 dark:text-emerald-400" : f.check.verdict === "not_ack" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>
                  {verdictText(f.check)}
                  {f.check.titleSeen && <span className="text-muted-foreground"> · title “{f.check.titleSeen}”</span>}
                  <div className="text-muted-foreground">{f.check.checkedByName} · {f.check.checkedAt.slice(0, 10)} · {Math.round(f.check.confidence * 100)}% sure</div>
                </div>
              ) : (
                <div className="text-muted-foreground">Not checked yet</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canVerify && (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-primary hover:underline disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {busy ? "Checking…" : ai === "unchecked" || ai === "unclear" ? "Check with AI" : "Re-check with AI"}
        </button>
      )}
      {err && <div className="max-w-[16rem] text-[10px] text-destructive">{err}</div>}
    </div>
  );
}
