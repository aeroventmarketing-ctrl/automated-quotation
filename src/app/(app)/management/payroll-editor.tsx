"use client";

import { useMemo, useState, useTransition } from "react";
import { getPayrollMonth, savePayrollMonth } from "./payroll-actions";
import { PNL_DEPARTMENTS, type DeptKey, type DeptSplit } from "@/lib/department-pnl";
import { formatCurrency } from "@/lib/utils";

const MS_PH = 8 * 3600 * 1000;
function manilaYm(): string {
  const d = new Date(Date.now() + MS_PH);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function PayrollEditor({ initialMonth, initial }: { initialMonth: string; initial: DeptSplit }) {
  const [month, setMonth] = useState(initialMonth);
  const [amounts, setAmounts] = useState<DeptSplit>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const cur = useMemo(manilaYm, []);
  const monthOptions = useMemo(() => {
    const [y, m] = cur.split("-").map(Number);
    const out: string[] = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  }, [cur]);

  const total = useMemo(() => PNL_DEPARTMENTS.reduce((a, d) => a + (Number(amounts[d.key]) || 0), 0), [amounts]);

  const onMonth = (ym: string) => {
    setMonth(ym);
    setSaved(false);
    startTransition(async () => setAmounts(await getPayrollMonth(ym)));
  };
  const setAmt = (k: DeptKey, v: string) => {
    setSaved(false);
    setAmounts((a) => ({ ...a, [k]: Number(v) || 0 }));
  };
  const save = () =>
    startTransition(async () => {
      await savePayrollMonth(month, amounts);
      setSaved(true);
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={month} onChange={(e) => onMonth(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
          {monthOptions.map((ym) => <option key={ym} value={ym}>{monthLabel(ym)}</option>)}
        </select>
        {pending && <span className="text-xs text-muted-foreground">Working…</span>}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PNL_DEPARTMENTS.map((d) => (
          <label key={d.key} className="flex items-center justify-between gap-2 rounded-md border p-2">
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
              {d.label}
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amounts[d.key] || ""}
              onChange={(e) => setAmt(d.key, e.target.value)}
              placeholder="0.00"
              className="h-8 w-32 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Total payroll · <span className="font-medium tabular-nums text-foreground">{formatCurrency(total)}</span></div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button onClick={save} disabled={pending} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
            Save {monthLabel(month)}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Payroll is added to each department&rsquo;s expenses in the P&amp;L for the month it belongs to.</p>
    </div>
  );
}
