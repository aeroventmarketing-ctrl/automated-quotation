import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { COMPANY } from "@/lib/config";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { buildSalesReport, REPORT_BASIS_LABEL, type ReportBasis } from "@/lib/sales-report";
import { ReportPrintBar } from "./report-print-bar";

export const dynamic = "force-dynamic";

function todayYmdManila(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; basis?: string }>;
}) {
  const sp = await searchParams;
  const today = todayYmdManila();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const basis: ReportBasis = sp.basis === "won" ? "won" : "created";
  const report = await buildSalesReport(from, to, basis).catch(() => null);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-2 print:p-0">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href="/inquiries?status=WON" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to WON inquiries
        </Link>
        <ReportPrintBar from={from} to={to} basis={basis} />
      </div>

      <div className="rounded-lg border bg-white p-6 text-black print:border-0 print:p-0">
        <div className="mb-4 border-b pb-3 text-center">
          <div className="text-lg font-bold">{COMPANY.name}</div>
          <div className="text-sm font-semibold">Sales Report — WON Inquiries (per Salesperson)</div>
          <div className="text-xs text-gray-600">
            {formatDate(from)} – {formatDate(to)} · by {REPORT_BASIS_LABEL[basis]} · Generated {formatDateTime(new Date())}
          </div>
        </div>

        {!report || report.totals.count === 0 ? (
          <p className="py-8 text-center text-sm text-gray-600">No WON inquiries in this date range.</p>
        ) : (
          <div className="space-y-5">
            {report.groups.map((g) => (
              <div key={g.salesperson} className="break-inside-avoid">
                <div className="mb-1 flex items-baseline justify-between border-b border-gray-300 pb-1">
                  <h3 className="text-sm font-bold">{g.salesperson}</h3>
                  <span className="text-xs text-gray-600">{g.count} won</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] text-gray-500">
                      <th className="py-1 pr-2 font-medium">Date</th>
                      <th className="py-1 px-2 font-medium">Quote #</th>
                      <th className="py-1 px-2 font-medium">Customer</th>
                      <th className="py-1 px-2 font-medium">Source</th>
                      <th className="py-1 px-2 text-right font-medium">Value</th>
                      <th className="py-1 px-2 text-right font-medium">Collected</th>
                      <th className="py-1 pl-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.quotationId} className="border-t border-gray-100">
                        <td className="py-1 pr-2 whitespace-nowrap">{formatDate(r.dateISO)}</td>
                        <td className="py-1 px-2 font-mono text-[11px] whitespace-nowrap">{r.quoteNumber}</td>
                        <td className="py-1 px-2">{r.company}</td>
                        <td className="py-1 px-2 text-gray-600">{r.source}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(r.value, report.currency)}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(r.collected, report.currency)}</td>
                        <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(r.balance, report.currency)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-300 font-semibold">
                      <td className="py-1 pr-2" colSpan={4}>Subtotal · {g.salesperson}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(g.value, report.currency)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{formatCurrency(g.collected, report.currency)}</td>
                      <td className="py-1 pl-2 text-right tabular-nums">{formatCurrency(g.balance, report.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}

            <table className="w-full border-t-2 border-black text-xs">
              <tbody>
                <tr className="font-bold">
                  <td className="py-2 pr-2">GRAND TOTAL · {report.totals.count} won across {report.groups.length} salesperson{report.groups.length === 1 ? "" : "s"}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(report.totals.value, report.currency)}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(report.totals.collected, report.currency)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(report.totals.balance, report.currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
