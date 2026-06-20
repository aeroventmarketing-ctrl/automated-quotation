import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Public, read-only shared quotation view (only for SENT quotes). */
export default async function PublicQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = await prisma.quotation.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      inquiry: { include: { customer: true } },
    },
  });

  if (!q || q.status !== "SENT") notFound();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-lg border bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-start justify-between border-b-2 border-primary pb-4">
          <div>
            <div className="text-xl font-bold text-primary">{COMPANY.name}</div>
            <div className="text-xs text-muted-foreground">{COMPANY.tagline}</div>
            <div className="text-xs text-muted-foreground">{COMPANY.email} · {COMPANY.phone}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">QUOTATION</div>
            <div className="text-sm">No. {q.quoteNumber}</div>
            <div className="text-sm text-muted-foreground">{formatDate(q.createdAt)}</div>
            {q.validUntil && <div className="text-sm text-muted-foreground">Valid until {formatDate(q.validUntil)}</div>}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-xs uppercase text-muted-foreground">Bill to</div>
          <div className="font-medium">{q.inquiry.customer.company}</div>
          {q.inquiry.customer.contactName && <div className="text-sm">{q.inquiry.customer.contactName}</div>}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-primary text-primary-foreground">
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Unit Price</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((it, i) => (
              <tr key={it.id} className="border-b">
                <td className="p-2">{i + 1}</td>
                <td className="p-2">
                  {it.descriptionSnapshot}
                  {it.selectionNote && <div className="text-xs text-muted-foreground">{it.selectionNote}</div>}
                </td>
                <td className="p-2 text-right">{it.qty}</td>
                <td className="p-2 text-right">{formatCurrency(Number(it.unitPrice), q.currency)}</td>
                <td className="p-2 text-right">{formatCurrency(Number(it.lineTotal), q.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(Number(q.subtotal), q.currency)}</span></div>
            <div className="flex justify-between"><span>VAT</span><span>{formatCurrency(Number(q.vat), q.currency)}</span></div>
            <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{formatCurrency(Number(q.total), q.currency)}</span></div>
          </div>
        </div>

        {q.terms && (
          <div className="mt-6 text-xs text-muted-foreground">
            <div className="font-medium uppercase">Terms &amp; Conditions</div>
            <p>{q.terms}</p>
          </div>
        )}
      </div>
    </div>
  );
}
