import { COMPANY } from "@/lib/config";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { buildSalesSummary } from "@/lib/sales-summary";
import { SummaryControls } from "./summary-controls";

export const dynamic = "force-dynamic";

function todayYmdManila(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function SalesSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const today = todayYmdManila();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const report = await buildSalesSummary(from, to).catch(() => null);
  const dash = (v: string) => (v.trim() ? v : "—");

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-2 print:p-0">
      <div className="flex items-center justify-end gap-2 print:hidden">
        <SummaryControls from={from} to={to} />
      </div>

      <div className="rounded-lg border bg-white p-6 text-black print:border-0 print:p-0">
        <div className="mb-4 border-b pb-3 text-center">
          <div className="text-lg font-bold">{COMPANY.name}</div>
          <div className="text-sm font-semibold">Sales Summary (Vatable)</div>
          <div className="text-xs text-gray-600">
            {formatDate(from)} – {formatDate(to)} · by Payment date · Generated {formatDateTime(new Date())}
          </div>
        </div>

        {!report || report.totals.count === 0 ? (
          <p className="py-8 text-center text-sm text-gray-600">No vatable sales in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase text-gray-500">
                  <th className="py-1 pr-2 font-medium">Date</th>
                  <th className="py-1 px-2 font-medium">SI Number</th>
                  <th className="py-1 px-2 font-medium">CR</th>
                  <th className="py-1 px-2 font-medium">DR</th>
                  <th className="py-1 px-2 font-medium">Company</th>
                  <th className="py-1 px-2 font-medium">TIN Number</th>
                  <th className="py-1 px-2 text-right font-medium">P.O. Amount</th>
                  <th className="py-1 px-2 text-right font-medium">EWT FP</th>
                  <th className="py-1 pl-2 font-medium">Company Address</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.quotationId} className="border-t border-gray-100 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{formatDate(r.dateISO)}</td>
                    <td className="py-1 px-2 font-mono text-[11px] whitespace-nowrap">{dash(r.siNumber)}</td>
                    <td className="py-1 px-2 font-mono text-[11px] whitespace-nowrap">{dash(r.crNumber)}</td>
                    <td className="py-1 px-2 font-mono text-[11px] whitespace-nowrap">{dash(r.drNumber)}</td>
                    <td className="py-1 px-2">{r.company}</td>
                    <td className="py-1 px-2 whitespace-nowrap">{dash(r.tin)}</td>
                    <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.poAmount, report.currency)}</td>
                    <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.ewt, report.currency)}</td>
                    <td className="py-1 pl-2 text-gray-600">{dash(r.address)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-black font-bold">
                  <td className="py-2 pr-2" colSpan={6}>GRAND TOTAL · {report.totals.count} sale{report.totals.count === 1 ? "" : "s"}</td>
                  <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(report.totals.poAmount, report.currency)}</td>
                  <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatCurrency(report.totals.ewt, report.currency)}</td>
                  <td className="py-2 pl-2" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
