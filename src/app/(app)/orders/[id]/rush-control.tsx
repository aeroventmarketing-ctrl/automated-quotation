"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RushBadge } from "@/components/rush-badge";
import { RUSH_ACTION_LABEL, type OrderRush, type RushStep } from "@/lib/rush-order";
import { rushStep } from "./rush-actions";

const fmt = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/**
 * The order's RUSH, in its Phase 1 box under the Client Due Date
 * (lib/rush-order): the Sales in-charge requests it with a reason; the Payment
 * Approver or an admin approves / declines, marks it directly, or removes it.
 */
export function RushControl({
  orderId,
  rush,
  daysLeft,
  hasClientDue,
  canRequest,
  canDecide,
  closed,
}: {
  orderId: string;
  rush: OrderRush | null;
  daysLeft: number | null;
  hasClientDue: boolean;
  canRequest: boolean;
  canDecide: boolean;
  closed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<RushStep["kind"] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const state = rush?.state ?? null;

  async function go(kind: RushStep["kind"], value = text) {
    setBusy(true);
    setErr(null);
    const step = (kind === "request" || kind === "mark" ? { kind, reason: value } : { kind, note: value }) as RushStep;
    const r = await rushStep(orderId, step).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Failed" }));
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setOpen(null);
    setText("");
    router.refresh();
  }

  const prompt: Partial<Record<RushStep["kind"], { label: string; placeholder: string; button: string; needsText: boolean }>> = {
    request: { label: "Request RUSH", placeholder: "Why is this a rush? (required)", button: "Send request", needsText: true },
    mark: { label: "Mark RUSH", placeholder: "Why is this a rush? (required)", button: "Mark RUSH", needsText: true },
    decline: { label: "Decline", placeholder: "Reason (optional)", button: "Decline request", needsText: false },
    remove: { label: "Remove RUSH", placeholder: "Why is the rush over? (required)", button: "Remove RUSH", needsText: true },
  };
  const form = open ? prompt[open] : undefined;
  const canAsk = !closed && (state === null || state === "declined" || state === "removed");

  return (
    <div className="w-full space-y-1.5 text-right sm:w-72" data-testid="rush-control">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rush order</div>

      {state === "active" && (
        <div className="space-y-1">
          <div className="flex justify-end"><RushBadge daysLeft={daysLeft} size="md" /></div>
          <div className="text-xs text-muted-foreground">{rush!.reason}</div>
          <div className="text-[11px] text-muted-foreground">
            {rush!.history[0]?.action === "marked" ? "Marked" : "Approved"} by {rush!.decidedByName} · {fmt(rush!.decidedAt)}
          </div>
        </div>
      )}
      {state === "requested" && (
        <div className="space-y-1">
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Zap className="h-3 w-3" /> RUSH requested
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{rush!.reason}</div>
          <div className="text-[11px] text-muted-foreground">
            By {rush!.requestedByName} · {fmt(rush!.requestedAt)} — awaiting the Payment Approver or an admin
          </div>
        </div>
      )}
      {state === "declined" && rush && (
        <div className="text-[11px] text-muted-foreground">
          Last request declined by {rush.decidedByName}{rush.history[0]?.note ? ` — ${rush.history[0].note}` : ""}
        </div>
      )}
      {state === null && !canRequest && !canDecide && <div className="text-xs text-muted-foreground">Not a rush order.</div>}

      {!open && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {state === "requested" && canDecide && (
            <>
              <Button size="sm" className="h-7 bg-red-600 text-xs hover:bg-red-700" disabled={busy} onClick={() => go("approve", "")}>
                {busy ? "Saving…" : "Approve RUSH"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => { setText(""); setOpen("decline"); }}>Decline</Button>
            </>
          )}
          {canAsk && canDecide && (
            <Button size="sm" variant="outline" className="h-7 border-red-400 text-xs text-red-700 hover:bg-red-50" onClick={() => { setText(""); setOpen("mark"); }}>
              <Zap className="h-3 w-3" /> Mark RUSH
            </Button>
          )}
          {canAsk && canRequest && !canDecide && (
            <Button size="sm" variant="outline" className="h-7 border-red-400 text-xs text-red-700 hover:bg-red-50" onClick={() => { setText(""); setOpen("request"); }}>
              <Zap className="h-3 w-3" /> Request RUSH
            </Button>
          )}
          {state === "active" && canDecide && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setText(""); setOpen("remove"); }}>Remove RUSH</Button>
          )}
        </div>
      )}
      {canAsk && (canRequest || canDecide) && !hasClientDue && !open && (
        <div className="text-[11px] text-amber-700">Set the Client Due Date first — a rush needs a date.</div>
      )}

      {form && open && (
        <div className="space-y-1.5 text-left">
          <Input className="h-8" value={text} onChange={(e) => setText(e.target.value)} placeholder={form.placeholder} aria-label={form.placeholder} maxLength={300} />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" className="h-7 text-xs" disabled={busy || (form.needsText && !text.trim())} onClick={() => go(open)}>
              {busy ? "Saving…" : form.button}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => { setOpen(null); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <div className="text-[11px] text-destructive">{err}</div>}

      {rush && rush.history.length > 0 && (
        <div>
          <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            {showHistory ? "Hide history" : `History (${rush.history.length})`}
          </button>
          {showHistory && (
            <ol className="mt-1 space-y-0.5 border-r-2 border-muted pr-2 text-[11px] leading-tight text-muted-foreground">
              {rush.history.map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="text-foreground">{RUSH_ACTION_LABEL[h.action]}</span>{h.note ? ` — ${h.note}` : ""}
                  <br />
                  {h.byName} · {fmt(h.at)}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
