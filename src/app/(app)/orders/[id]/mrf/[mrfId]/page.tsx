import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { readOrderWorkflow, deptLabel } from "@/lib/order-workflow";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** Printable Material Request Form (mirrors AeroVent's paper form). */
export default async function MrfPrintPage({ params }: { params: Promise<{ id: string; mrfId: string }> }) {
  const { id, mrfId } = await params;
  const quote = await prisma.quotation.findUnique({
    where: { id },
    include: { inquiry: { include: { customer: true } } },
  });
  if (!quote) notFound();
  const wf = readOrderWorkflow(quote.classification);
  const mrf = wf.materialRequests.find((m) => m.id === mrfId);
  if (!mrf) notFound();

  // Pad the item rows so the form always looks like a full sheet.
  const rows = [...mrf.items];
  while (rows.length < 12) rows.push({ description: "", qty: "", unit: "", remark: "" });

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #mrf-sheet, #mrf-sheet * { visibility: visible !important; }
          #mrf-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-center justify-between">
        <Link href={`/orders/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to order
        </Link>
        <PrintButton />
      </div>

      <div id="mrf-sheet" className="mx-auto max-w-[800px] rounded-md border bg-white p-8 text-black">
        {/* Header */}
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
          <div className="text-right text-xl font-bold text-red-600">{mrf.formNo}</div>
        </div>

        <h1 className="mt-3 text-center text-base font-bold tracking-wide">CONSUMABLES, TOOLS &amp; MATERIAL REQUEST FORM</h1>

        {/* Requested by / date */}
        <div className="mt-4 flex items-end justify-between gap-6 text-sm">
          <div className="flex-1">
            <div className="border-b border-black pb-0.5 font-medium">{mrf.raisedByName}</div>
            <div className="text-[11px] text-gray-600">Printed name</div>
          </div>
          <div className="w-48">
            <div className="border-b border-black pb-0.5 font-medium">{mrf.raisedAt ? formatDate(new Date(mrf.raisedAt)) : ""}</div>
            <div className="text-[11px] text-gray-600">Date</div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-gray-600">
          Department: <b>{deptLabel(mrf.dept)}</b> · Order: <b>{quote.quoteNumber}</b> · {quote.inquiry.customer.company}
        </div>

        {/* Items table */}
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-black bg-gray-100 px-2 py-1 text-left">ARTICLES / DESCRIPTION</th>
              <th className="w-16 border border-black bg-gray-100 px-2 py-1">Qty</th>
              <th className="w-20 border border-black bg-gray-100 px-2 py-1">Unit</th>
              <th className="w-40 border border-black bg-gray-100 px-2 py-1">Remark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={i}>
                <td className="border border-black px-2 py-1.5">{it.description}</td>
                <td className="border border-black px-2 py-1.5 text-center">{it.qty}</td>
                <td className="border border-black px-2 py-1.5 text-center">{it.unit}</td>
                <td className="border border-black px-2 py-1.5">{it.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {mrf.note && <p className="mt-2 text-sm">Note: {mrf.note}</p>}

        {/* Signatures */}
        <div className="mt-10 flex justify-between gap-8 text-center text-[11px]">
          <div className="flex-1"><div className="border-t border-black pt-1">Requested by</div></div>
          <div className="flex-1"><div className="border-t border-black pt-1">Issued / Approved by</div></div>
          <div className="flex-1"><div className="border-t border-black pt-1">Received by</div></div>
        </div>
      </div>
    </div>
  );
}
