import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatCurrency, formatDate } from "@/lib/utils";
import { coercePurchaseOrder, poLineAmount, poTotals } from "@/lib/purchase-order";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** Printable supplier Purchase Order (mirrors AeroVent's PO template). */
export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string; prId: string }> }) {
  const { id, prId } = await params;
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId } });
  if (!pr || pr.quotationId !== id) notFound();
  const po = coercePurchaseOrder(pr.po);
  if (!po) notFound();

  const totals = poTotals(po);
  // Pad rows so the sheet always looks complete.
  const rows = [...po.lines];
  while (rows.length < 6) rows.push({ description: "", qty: "", unit: "", unitPrice: "" });

  const field = (label: string, value: string) => (
    <tr>
      <td className="w-40 border border-black bg-gray-100 px-2 py-1 font-medium">{label}</td>
      <td className="border border-black px-2 py-1">{value}</td>
    </tr>
  );

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #po-sheet, #po-sheet * { visibility: visible !important; }
          #po-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-center justify-between">
        <Link href={`/orders/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to order
        </Link>
        <PrintButton />
      </div>

      <div id="po-sheet" className="mx-auto max-w-[800px] rounded-md border bg-white p-8 text-black">
        {/* Letterhead */}
        <div className="flex items-start gap-4 border-b-2 border-black pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aerovent-logo.jpg" alt="AeroVent" className="h-14 w-auto" />
          <div className="flex-1 text-center text-[11px] leading-tight">
            <div className="text-lg font-extrabold tracking-wide">{COMPANY.name}</div>
            <div className="italic">{COMPANY.tagline}</div>
            <div>{COMPANY.manilaOffice}</div>
            <div>{COMPANY.landline}</div>
            <div>{COMPANY.mobile}</div>
            <div>{COMPANY.plantAddress}</div>
            <div>Email: {COMPANY.email} · {COMPANY.website}</div>
          </div>
        </div>

        <h1 className="mt-3 text-center text-base font-bold tracking-wide">Purchase Order</h1>

        {/* Supplier block */}
        <table className="mt-3 w-full border-collapse text-sm">
          <tbody>
            {field("Company Name", po.supplier.company)}
            {field("Attention", po.supplier.attention)}
            {field("Address", po.supplier.address)}
            {field("Date", po.date ? formatDate(new Date(po.date)) : "")}
            {field("P.O. Number", po.poNumber)}
          </tbody>
        </table>

        {/* Line items */}
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-12 border border-black bg-gray-100 px-2 py-1">Item</th>
              <th className="border border-black bg-gray-100 px-2 py-1 text-left">Description</th>
              <th className="w-14 border border-black bg-gray-100 px-2 py-1">Qty</th>
              <th className="w-14 border border-black bg-gray-100 px-2 py-1">Unit</th>
              <th className="w-24 border border-black bg-gray-100 px-2 py-1 text-right">Unit Price</th>
              <th className="w-28 border border-black bg-gray-100 px-2 py-1 text-right">Gross Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td className="border border-black px-2 py-1.5 text-center">{l.description ? i + 1 : ""}</td>
                <td className="border border-black px-2 py-1.5">{l.description}</td>
                <td className="border border-black px-2 py-1.5 text-center">{l.qty}</td>
                <td className="border border-black px-2 py-1.5 text-center">{l.unit}</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{l.description ? Number(String(l.unitPrice).replace(/,/g, "")).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                <td className="border border-black px-2 py-1.5 text-right tabular-nums">{l.description ? formatCurrency(poLineAmount(l), "PHP").replace("₱", "") : ""}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1.5 text-center font-semibold">TOTAL AMOUNT</td>
              <td className="border border-black px-2 py-1.5 text-right font-semibold tabular-nums">{totals.total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1.5 text-center">LESS EWT {po.ewtPct}%</td>
              <td className="border border-black px-2 py-1.5 text-right tabular-nums">{totals.ewt.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1.5 text-center font-semibold">NET AMOUNT =&gt;</td>
              <td className="border border-black px-2 py-1.5 text-right font-semibold tabular-nums">{totals.net.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        {/* Remarks */}
        <div className="mt-2 text-sm">
          <span className="italic">Remarks:</span>
          <div className="mt-1 pl-4">{po.remarks}</div>
        </div>

        {/* Footer — purchaser signature + AeroVent payee details */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div>
            <div className="h-10" />
            <div className="border-t border-black pt-1 text-center text-[12px]">
              <div>{COMPANY.poSignatoryTitle}</div>
              <div className="font-semibold">AEROVENT</div>
            </div>
          </div>
          <div className="text-[12px] leading-relaxed">
            <div className="font-semibold">{COMPANY.poBank.bank}</div>
            <div>{COMPANY.poBank.name}</div>
            <div>{COMPANY.poBank.number}</div>
            <div className="mt-2 font-semibold">GCASH</div>
            <div>{COMPANY.poGcash.name}</div>
            <div>{COMPANY.poGcash.number}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
