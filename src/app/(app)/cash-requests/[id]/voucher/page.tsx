import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { coerceCashLines } from "@/lib/cash-request";
import { pesoAmountInWords } from "@/lib/amount-words";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toNum = (v: unknown) => { const n = Number(v as never); return Number.isFinite(n) ? n : 0; };

/** Printable cash voucher — a faithful reproduction of AeroVent's cash-voucher
 *  pad (Paid to / Date / No. · Particular–Amount · Total · Received from … the
 *  amount of PESOS · Prepared by / Approved by / By). */
export default async function CashVoucherPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cr = await prisma.cashRequest.findUnique({ where: { id } });
  if (!cr) notFound();

  const amount = toNum(cr.amount);
  const reqLines = coerceCashLines(cr.lines);
  const lines = reqLines.length ? reqLines : [{ description: cr.purpose, amount }];
  const rows = [...lines];
  while (rows.length < 8) rows.push({ description: "", amount: 0 });
  const dateStr = formatDate(cr.voucherAt ?? cr.createdAt);
  const preparedBy = cr.voucherByName ?? "";
  const approvedBy = cr.releasedByName ?? cr.decidedByName ?? "";

  return (
    <div>
      <style>{`
        @page { size: auto; margin: 0; }
        @media print {
          html, body { margin: 0 !important; }
          body * { visibility: hidden !important; }
          #voucher-sheet, #voucher-sheet * { visibility: visible !important; }
          #voucher-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 14mm !important; border: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/cash-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to cash requests
        </Link>
        <PrintButton />
      </div>

      <div id="voucher-sheet" className="mx-auto max-w-[760px] rounded-md border bg-white p-10 text-black">
        {/* Company + voucher number */}
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold leading-tight">{COMPANY.name}</div>
          <div className="text-sm">No.&nbsp;<span className="font-bold tracking-wide text-red-600">{cr.number}</span></div>
        </div>

        <h1 className="mt-2 text-center text-2xl font-extrabold tracking-wide underline underline-offset-4">CASH VOUCHER</h1>

        {/* Paid to / Address / Date */}
        <div className="mt-5 flex items-end justify-between gap-6 text-sm">
          <div className="flex-1 space-y-2">
            <div className="flex items-end gap-2">
              <span className="shrink-0">Paid to</span>
              <span className="flex-1 border-b border-black px-1 font-medium">{cr.requestedByName}</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="shrink-0">Address</span>
              <span className="flex-1 border-b border-black px-1">&nbsp;</span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className="shrink-0">Date</span>
            <span className="min-w-[7rem] border-b border-black px-1 text-center">{dateStr}</span>
          </div>
        </div>

        {/* Particular / Amount */}
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-black py-1.5 text-center font-bold tracking-[0.2em]">PARTICULAR</th>
              <th className="w-40 border border-black py-1.5 text-center font-bold tracking-wide">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td className="h-7 border-x border-black px-2 align-middle">{l.description}</td>
                <td className="h-7 border-x border-black px-2 text-right align-middle tabular-nums">{l.amount ? peso(l.amount) : ""}</td>
              </tr>
            ))}
            <tr>
              <td className="border border-black px-2 py-1.5 text-right font-semibold">TOTAL&nbsp;&nbsp;&nbsp;Php</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold tabular-nums">{peso(amount)}</td>
            </tr>
          </tbody>
        </table>

        {/* Received-from statement */}
        <p className="mt-4 text-sm leading-relaxed">
          RECEIVED from <span className="font-medium">{COMPANY.name}</span> the amount of{" "}
          <span className="font-semibold">{pesoAmountInWords(amount)}</span> PESOS (Php&nbsp;
          <span className="font-semibold tabular-nums">{peso(amount)}</span>) in full payment of amount described above.
        </p>

        {/* Signatories */}
        <div className="mt-8 flex items-end justify-between gap-8">
          <table className="border-collapse text-sm">
            <tbody>
              <tr>
                <td className="border border-black px-3 pb-6 pt-1 align-top">
                  <div>Prepared by:</div>
                  <div className="mt-4 text-center font-medium">{preparedBy}</div>
                </td>
                <td className="border border-black px-3 pb-6 pt-1 align-top">
                  <div>Approved by:</div>
                  <div className="mt-4 text-center font-medium">{approvedBy}</div>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flex-1 text-right text-sm">
            <div className="inline-block text-left">
              <div>By:</div>
              <div className="mt-2 min-w-[12rem] border-b border-black px-1 text-center font-medium">{cr.receivedByName ?? ""}</div>
              <div className="text-[11px] text-neutral-500">(received by)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
