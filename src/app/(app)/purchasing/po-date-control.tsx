"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { poDateYmd, type PoDateChange } from "@/lib/po-date";
import { changePoDate } from "./po-date-actions";

/**
 * Who may change a PO date on this page, and each PO's last change — provided
 * once by the Purchasing workspace instead of threaded through every list. The
 * default (no provider: the order page, Requisitions) shows the date read-only.
 */
const PoDateContext = createContext<{ canChange: boolean; changes: Record<string, PoDateChange> }>({ canChange: false, changes: {} });

export function PoDateProvider({ canChange, changes, children }: { canChange: boolean; changes: Record<string, PoDateChange>; children: ReactNode }) {
  return <PoDateContext.Provider value={{ canChange, changes }}>{children}</PoDateContext.Provider>;
}

const fmt = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—";
};

/**
 * "PO date Oct 26, 2026 · Change" beside Print PO & 2307. Changing it asks for
 * the new date and a reason; the last change shows underneath.
 */
export function PoDateControl({ prId, date }: { prId: string; date: string | null | undefined }) {
  const { canChange, changes } = useContext(PoDateContext);
  const router = useRouter();
  const ymd = poDateYmd(date);
  const last = changes[prId];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(ymd);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const r = await changePoDate(prId, value, reason).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Failed" }));
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <div className="text-xs">
      <div className="flex items-center gap-1.5">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">PO date</span>
        <span className="font-medium">{ymd ? fmt(ymd) : "—"}</span>
        {canChange && !open && (
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setValue(ymd); setOpen(true); }}>
            Change
          </button>
        )}
      </div>
      {last && !open && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Changed from {fmt(last.from)} by {last.byName}, {fmt(last.at.slice(0, 10))}{last.reason ? ` — ${last.reason}` : ""}
        </div>
      )}
      {open && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Input type="date" className="h-8 w-40" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New PO date" />
          <Input className="h-8 w-56" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason for the change" maxLength={300} />
          <Button size="sm" className="h-8" disabled={busy || !value || !reason.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
          <span className="w-full text-[11px] text-muted-foreground">Changes the printed PO and the 2307&apos;s quarter and month. On a combined PO, every request on it.</span>
          {err && <span className="w-full text-[11px] text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}
