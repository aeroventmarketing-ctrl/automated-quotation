import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { coercePurchaseOrder, poLineAmount, poTotals } from "@/lib/purchase-order";
import { AEROVENT_LOGO } from "@/lib/pdf/logo";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Printable supplier Purchase Order — a faithful reproduction of AeroVent's PO
 *  template. Only the data (supplier, items, totals, remarks) is filled in; the
 *  letterhead, layout and footer are fixed to match the standard form. */
export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string; prId: string }> }) {
  const { id, prId } = await params;
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: prId } });
  if (!pr || pr.quotationId !== id) notFound();
  const po = coercePurchaseOrder(pr.po);
  if (!po) notFound();

  const totals = poTotals(po);
  // Pad rows so the sheet always looks like the standard form.
  const rows = [...po.lines];
  while (rows.length < 6) rows.push({ description: "", qty: "", unit: "", unitPrice: "" });

  const supplierRow = (label: string, value: string) => (
    <tr>
      <td className="w-36 border border-black px-2 py-1 align-top font-medium">{label}</td>
      <td className="border border-black px-2 py-1 align-top">{value}</td>
    </tr>
  );

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #po-sheet, #po-sheet * { visibility: visible !important; }
          #po-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 0; border: 0 !important; }
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
        {/* Letterhead — identical to the quotation (same logo + text) */}
        <div className="border-b border-black pb-1.5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AEROVENT_LOGO} alt="AEROVENT" className="mx-auto h-[50px] w-auto object-contain" />
          <div className="mt-0.5 text-[13px] font-bold leading-tight">FANS AND BLOWERS MANUFACTURING</div>
          <div className="text-[10px] font-bold tracking-wide">VENTILATION, AIR MOVING &amp; ENGINEERING SPECIALISTS</div>
          <div className="mt-0.5 text-[9px] leading-tight">
            <div>{COMPANY.manilaOffice}</div>
            <div>{COMPANY.landline}</div>
            <div>{COMPANY.mobile}</div>
            <div>{COMPANY.plantAddress}</div>
            <div>Email: {COMPANY.email} &nbsp;/&nbsp; Website: {COMPANY.website}</div>
          </div>
        </div>

        <h1 className="mb-1 mt-2 text-center text-[15px] font-bold">Purchase Order</h1>

        {/* Supplier details */}
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {supplierRow("Company Name", po.supplier.company)}
            {supplierRow("Attention", po.supplier.attention)}
            {supplierRow("Address", po.supplier.address)}
            {supplierRow("Date", po.date ? formatDate(new Date(po.date)) : "")}
            {supplierRow("P.O. Number", po.poNumber)}
          </tbody>
        </table>

        {/* Line items + totals + remarks — one continuous ruled form */}
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="w-12 border border-black px-2 py-1 font-medium">Item</th>
              <th className="border border-black px-2 py-1 font-medium">Description</th>
              <th className="w-12 border border-black px-2 py-1 font-medium">Qty</th>
              <th className="w-12 border border-black px-2 py-1 font-medium">Unit</th>
              <th className="w-24 border border-black px-2 py-1 font-medium">Unit Price</th>
              <th className="w-28 border border-black px-2 py-1 font-medium">Gross Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td className="h-9 border border-black px-2 text-center">{l.description ? i + 1 : ""}</td>
                <td className="border border-black px-2 text-center">{l.description}</td>
                <td className="border border-black px-2 text-center">{l.qty}</td>
                <td className="border border-black px-2 text-center">{l.unit}</td>
                <td className="border border-black px-2 text-right tabular-nums">{l.description ? peso(Number(String(l.unitPrice).replace(/,/g, "")) || 0) : ""}</td>
                <td className="border border-black px-2 text-right tabular-nums">{l.description ? peso(poLineAmount(l)) : ""}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1 text-center font-semibold">TOTAL AMOUNT</td>
              <td className="border border-black px-2 py-1 text-right font-semibold tabular-nums">{peso(totals.total)}</td>
            </tr>
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1 text-center font-semibold">LESS EWT {po.ewtPct}%</td>
              <td className="border border-black px-2 py-1 text-right tabular-nums">{peso(totals.ewt)}</td>
            </tr>
            <tr>
              <td colSpan={5} className="border border-black px-2 py-1 text-center font-semibold">NET AMOUNT =&gt;</td>
              <td className="border border-black px-2 py-1 text-right font-semibold tabular-nums">{peso(totals.net)}</td>
            </tr>
            <tr>
              <td colSpan={6} className="border border-black px-2 py-2 align-top">
                <span className="italic">Remarks:</span>
                <div className="mt-1 pl-6">{po.remarks}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Footer — purchaser signature (left) + AeroVent payee details (right) */}
        <div className="mt-8 grid grid-cols-2 gap-8 text-[12px]">
          <div>
            <div className="h-12" />
            <div className="w-60 border-t border-black pt-1 text-center">
              <div>{COMPANY.poSignatoryTitle}</div>
              <div>AEROVENT</div>
            </div>
          </div>
          <div className="leading-relaxed">
            <div>{COMPANY.poBank.bank}</div>
            <div>{COMPANY.poBank.name}</div>
            <div>{COMPANY.poBank.number}</div>
            <div className="mt-3">GCASH</div>
            <div>{COMPANY.poGcash.name}</div>
            <div>{COMPANY.poGcash.number}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
