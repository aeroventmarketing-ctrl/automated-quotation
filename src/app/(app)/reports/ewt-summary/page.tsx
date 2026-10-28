import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { COMPANY } from "@/lib/config";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { canUseEwtSummary, ewtPeriod, ewtTotals, ewtStatus, EWT_TABLE_TITLE, type EwtKind, type EwtRow } from "@/lib/ewt-summary";
import { loadEwtSummary } from "@/lib/ewt-summary-data";
import { PeriodPicker, ExportButtons, PrintButton, PopCell, ApplyToUnpaid } from "./ewt-controls";

export const dynamic = "force-dynamic";

/**
 * EWT Summary — the owner's template, live: Supplier EWT (1601-EQ) and Client EWT
 * (1701Q), by month or quarter, each row Paid once its proof of payment to BIR
 * is attached. See lib/ewt-summary.
 */
export default async function EwtSummaryPage({ searchParams }: { searchParams: Promise<{ mode?: string; period?: string }> }) {
  const sp = await searchParams;
  const [viewer, roles] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  if (!canUseEwtSummary(viewer, roles)) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">EWT Summary</h1>
        <p className="text-sm text-muted-foreground">The EWT Summary is for admins, the Payment Approver and Accounting.</p>
      </div>
    );
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const period = ewtPeriod(sp.mode, sp.period, today);
  const query = `mode=${period.mode}&period=${period.key}`;
  let data: Awaited<ReturnType<typeof loadEwtSummary>> | null = null;
  try {
    data = await loadEwtSummary(period);
  } catch (e) {
    console.error("EWT summary failed", e);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">EWT Summary</h1>
          <p className="text-sm text-muted-foreground">
            Supplier EWT we withheld on POs (1601-EQ) and Client EWT withheld from us on sales (1701Q). A row is Paid once its proof of payment to BIR is attached.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode={period.mode} periodKey={period.key} />
          <PrintButton />
        </div>
      </div>

      <div className="hidden text-center print:block">
        <div className="text-lg font-bold">{COMPANY.name}</div>
        <div className="text-sm font-semibold">EWT SUMMARY</div>
        <div className="text-xs">Generation: {period.mode === "quarter" ? "Quarterly" : "Monthly"} — {period.label}</div>
      </div>

      {!data ? (
        <p className="text-sm text-destructive">The EWT Summary couldn&apos;t be loaded just now. Refresh to try again.</p>
      ) : (
        <>
          {data.proofsMissing && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 print:hidden dark:bg-amber-950/40 dark:text-amber-200">
              Proofs can&apos;t be saved yet — apply migration <b>0063_ewt_remittance</b> in Supabase. Until then every row reads Unpaid.
            </p>
          )}
          <EwtTable kind="supplier" rows={data.supplier} periodLabel={period.label} query={query} />
          <EwtTable kind="client" rows={data.client} periodLabel={period.label} query={query} />
        </>
      )}
    </div>
  );
}

function EwtTable({ kind, rows, periodLabel, query }: { kind: EwtKind; rows: EwtRow[]; periodLabel: string; query: string }) {
  const t = ewtTotals(rows);
  const peso = (n: number) => formatCurrency(n, "PHP");
  const unpaidKeys = rows.filter((r) => !r.pop).map((r) => r.refKey);
  const partyHead = kind === "supplier" ? "Supplier's address" : "Client's address";
  return (
    <section className="rounded-lg border bg-card p-4 print:break-inside-avoid print:border-0 print:p-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{EWT_TABLE_TITLE[kind]}</h2>
          <p className="text-xs text-muted-foreground">
            {periodLabel} · {t.count} row{t.count === 1 ? "" : "s"} · EWT {peso(t.ewt)} · {t.paid} paid, {t.unpaid} unpaid{t.unpaid ? ` (${peso(t.unpaidEwt)} still to remit)` : ""}
            {kind === "supplier" ? " · dated by the PO date, as on the 2307" : " · dated by the client's payment"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplyToUnpaid kind={kind} refKeys={unpaidKeys} />
          <ExportButtons kind={kind} query={query} />
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {kind === "supplier" ? "No PO with EWT was paid in this period." : "No client withheld EWT on a payment in this period."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-xs">
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.refKey} className="border-b align-top last:border-0">
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
                </tr>
              ))}
              <tr className="border-t-2 border-foreground font-bold">
                <td className="py-2 pr-2" colSpan={5}>TOTAL · {t.count}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(t.gross)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(t.netOfVat)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{peso(t.ewt)}</td>
                <td className="px-2 py-2" colSpan={2}>{t.paid} paid · {t.unpaid} unpaid</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
