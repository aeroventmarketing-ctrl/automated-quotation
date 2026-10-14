"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { purchaseDueTone, dueCountdown, type DueTone } from "@/lib/purchaser-plan";
import { describeClientDueChange, type OrderClientDue } from "@/lib/order-client-due";
import { setOrderClientDue } from "./client-due-actions";

/** The Purchase Plan's due-date colours, so a date reads the same everywhere. */
const TONE_CLASS: Record<DueTone, string> = {
  overdue: "border-red-400 bg-red-200 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  due3: "border-orange-400 bg-orange-200 text-orange-950 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
  due7: "border-yellow-400 bg-yellow-100 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  ontime: "border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};
const fmtStamp = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/**
 * "Client Due Date" with a date picker under it, at the right of the Phase 1
 * box — the owner's ask, to monitor the client due. Saves as soon as a date is
 * picked; read-only for those who may not set it. This is the ONLY place the
 * date is edited; the Purchase Plan shows it, greyed out, on every MRF row of
 * the order. "History" lists every change — who, when, from what, to what.
 */
export function ClientDuePicker({
  orderId,
  initial,
  canEdit,
  todayYMD,
}: {
  orderId: string;
  initial: OrderClientDue | null;
  canEdit: boolean;
  todayYMD: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial?.date ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const history = initial?.history ?? [];

  async function save(next: string) {
    setValue(next);
    setBusy(true);
    setErr(null);
    try {
      await setOrderClientDue(orderId, next);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
      setValue(initial?.date ?? "");
    } finally {
      setBusy(false);
    }
  }

  const tone = purchaseDueTone(value || null, todayYMD);
  return (
    <div className="space-y-1 sm:text-right" data-testid="client-due">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client Due Date</div>
      {canEdit ? (
        <div className="flex items-center gap-2 sm:justify-end">
          <input
            type="date"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={value}
            disabled={busy}
            onChange={(e) => save(e.target.value)}
            aria-label="Client due date"
          />
          {value && (
            <button type="button" className="text-xs text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => save("")}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <div className="text-sm font-medium">{value ? fmtDay(value) : "—"}</div>
      )}
      {value && tone && (
        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>{dueCountdown(value, todayYMD)}</span>
      )}
      {initial?.byName && value === initial.date && (
        <p className="text-[11px] text-muted-foreground">Set by {initial.byName}{initial.at ? ` · ${fmtStamp(initial.at)}` : ""}</p>
      )}
      {history.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-[11px] font-medium text-primary hover:underline" aria-expanded={showHistory}>
            {showHistory ? "Hide history" : `History (${history.length})`}
          </button>
          {showHistory && (
            <ol className="mt-1 space-y-0.5 border-l-2 border-muted pl-2 text-left text-[11px] leading-tight text-muted-foreground sm:ml-auto sm:max-w-[16rem]">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="text-foreground">{describeClientDueChange(h, fmtDay)}</span>
                  <br />
                  {h.byName} · {fmtStamp(h.at)}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
