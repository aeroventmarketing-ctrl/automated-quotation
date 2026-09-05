"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { purchaseDueState, type PurchaseDueState } from "@/lib/job-order-due";
import { setPurchaseDue } from "../orders/actions";

/**
 * The **due date of purchase** on one request — the owner's *"purchaser or
 * admin/payment approver can add due date of purchase."*
 *
 * Production's deadlines live on the order page, so a purchaser deciding what to
 * buy first had nothing on their own screen to sort by. This is that date, set
 * where the buying is done.
 *
 * It goes quiet once the goods are bought. A screen that keeps a purchased item
 * red teaches people to ignore red.
 */
const TONE: Record<PurchaseDueState, string> = {
  none: "text-muted-foreground",
  soon: "text-amber-700",
  due: "font-medium text-amber-800",
  overdue: "font-medium text-destructive",
  met: "text-emerald-700",
};

const WORD: Record<PurchaseDueState, string> = {
  none: "Buy by",
  soon: "Buy by",
  due: "Buy today —",
  overdue: "Overdue —",
  met: "Bought · was due",
};

export function PurchaseDueControl({
  prId,
  dueAt,
  canSet,
  purchased,
  todayYMD,
}: {
  prId: string;
  dueAt: string | null;
  canSet: boolean;
  /** The goods are bought, so the date has done its job. */
  purchased: boolean;
  todayYMD: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(dueAt ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Nothing set and nothing this viewer can do about it — say nothing at all
  // rather than add a dead label to every row.
  if (!dueAt && !canSet) return null;

  const state = purchaseDueState(dueAt, todayYMD, purchased);

  async function save(next: string | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await setPurchaseDue(prId, next);
      if (res.error) { setErr(res.error); return; }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the date.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        <Input
          type="date"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="h-7 w-[9.5rem] text-xs"
          aria-label="Due date of purchase"
        />
        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => save(val || null)}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {dueAt && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => { setVal(""); save(null); }}>
            Clear
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => { setEditing(false); setVal(dueAt ?? ""); setErr(null); }}>
          Cancel
        </Button>
        {err && <span className="text-destructive">{err}</span>}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${TONE[state]}`}>
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      {dueAt ? <>{WORD[state]} {formatDate(dueAt)}</> : <span className="text-muted-foreground">No purchase due date</span>}
      {canSet && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-0.5 font-medium underline-offset-2 hover:underline"
        >
          {/* Not "set": "No purchase due date set" reads as a statement about
              the date rather than the button that fixes it. */}
          {dueAt ? "Change" : "Add one"}
        </button>
      )}
    </span>
  );
}
