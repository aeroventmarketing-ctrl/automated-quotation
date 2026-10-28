"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ewtStatus, ewtTotals, EWT_TABLE_TITLE, type EwtKind, type EwtRow } from "@/lib/ewt-summary";
import { ExportButtons, PopCell, AttachToRows } from "./ewt-controls";

const peso = (n: number) => formatCurrency(n, "PHP");
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One EWT table. The tick box on the right of each unpaid row picks the rows a
 * BIR payment covered — the owner: *"choose the rows that is already paid and
 * will be uploaded with a proof of payment to BIR"* — and one upload then puts
 * that proof on exactly those rows. A paid row already has its proof, so it
 * has nothing to tick.
 */
export function EwtTable({ kind, rows, periodLabel, query }: { kind: EwtKind; rows: EwtRow[]; periodLabel: string; query: string }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const t = ewtTotals(rows);
  const unpaid = useMemo(() => rows.filter((r) => !r.pop), [rows]);
  // Only rows still unpaid can be ticked — a proof attached since (by someone
  // else, or by this upload) drops out of the selection on the next render.
  const live = useMemo(() => new Set([...ticked].filter((k) => unpaid.some((r) => r.refKey === k))), [ticked, unpaid]);
  const tickedEwt = round2(unpaid.filter((r) => live.has(r.refKey)).reduce((a, r) => a + r.ewt, 0));
  const allTicked = unpaid.length > 0 && live.size === unpaid.length;
  const toggle = (k: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const partyHead = kind === "supplier" ? "Supplier's address" : "Client's address";

  return (
    <section className="rounded-lg border bg-card p-4 print:break-inside-avoid print:border-0 print:p-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{EWT_TABLE_TITLE[kind]}</h2>
          <p className="text-xs text-muted-foreground">
            {periodLabel} · {t.count} row{t.count === 1 ? "" : "s"} · EWT {peso(t.ewt)} · {t.paid} paid, {t.unpaid} unpaid{t.unpaid ? ` (${peso(t.unpaidEwt)} still to remit)` : ""}
            {kind === "supplier" ? " · dated when the supplier was paid" : " · dated by the client's payment"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live.size > 0 ? (
            <>
              <span className="text-xs text-muted-foreground print:hidden">
                {live.size} ticked · EWT <b className="text-foreground">{peso(tickedEwt)}</b>
              </span>
              <AttachToRows kind={kind} refKeys={[...live]} label={`Attach proof to ${live.size} ticked`} onDone={() => setTicked(new Set())} />
              <button type="button" className="text-xs text-muted-foreground hover:underline print:hidden" onClick={() => setTicked(new Set())}>
                Clear
              </button>
            </>
          ) : (
            <AttachToRows kind={kind} refKeys={unpaid.map((r) => r.refKey)} label={`Attach one proof to all ${unpaid.length} unpaid`} />
          )}
          <ExportButtons kind={kind} query={query} />
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {kind === "supplier" ? "No PO with EWT was paid in this period." : "No client withheld EWT on a payment in this period."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Registered name</th>
                <th className="px-2 py-1.5 font-medium">{partyHead}</th>
                <th className="px-2 py-1.5 font-medium">TIN</th>
                <th className="px-2 py-1.5 font-medium">S.I. #</th>
                <th className="px-2 py-1.5 text-right font-medium">Gross taxable {kind === "supplier" ? "purchase" : "sale"}</th>
                <th className="px-2 py-1.5 text-right font-medium">Net of VAT</th>
                <th className="px-2 py-1.5 text-right font-medium">EWT</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="py-1.5 pl-2 font-medium">POP</th>
                <th className="w-8 py-1.5 pl-2 text-center print:hidden">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer align-middle"
                    disabled={unpaid.length === 0}
                    checked={allTicked}
                    onChange={() => setTicked(allTicked ? new Set() : new Set(unpaid.map((r) => r.refKey)))}
                    aria-label="Tick every unpaid row"
                    title="Tick every unpaid row"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = live.has(r.refKey);
                return (
                  <tr key={r.refKey} className={`border-b align-top last:border-0 ${on ? "bg-primary/5" : ""}`}>
                    <td className="whitespace-nowrap py-1.5 pr-2">
                      {formatDate(r.date)}
                      <div className="text-[10px] text-muted-foreground print:hidden">{r.dateBasis}</div>
                    </td>
                    <td className="max-w-[12rem] px-2 py-1.5">
                      <div className="font-medium">{r.registeredName}</div>
                      {r.href ? (
                        <Link href={r.href} className="font-mono text-[10px] text-primary hover:underline print:text-foreground">{r.reference}</Link>
                      ) : (
                        <span className="font-mono text-[10px] text-muted-foreground">{r.reference}</span>
                      )}
                    </td>
                    <td className="max-w-[10rem] px-2 py-1.5 text-muted-foreground">{r.address || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.tin || <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono">{r.siNumber || <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{peso(r.gross)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{peso(r.netOfVat)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums">{peso(r.ewt)}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant={r.pop ? "success" : "warning"} className="font-normal">{ewtStatus(r)}</Badge>
                    </td>
                    <td className="py-1.5 pl-2"><PopCell kind={kind} refKey={r.refKey} pop={r.pop} /></td>
                    <td className="py-1.5 pl-2 text-center print:hidden">
                      {!r.pop && (
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 cursor-pointer"
                          checked={on}
                          onChange={() => toggle(r.refKey)}
                          aria-label={`Tick ${r.reference} — paid to BIR`}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-foreground font-bold">
                <td className="py-2 pr-2" colSpan={5}>TOTAL · {t.count}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(t.gross)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(t.netOfVat)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(t.ewt)}</td>
                <td className="px-2 py-2" colSpan={2}>{t.paid} paid · {t.unpaid} unpaid</td>
                <td className="print:hidden" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
