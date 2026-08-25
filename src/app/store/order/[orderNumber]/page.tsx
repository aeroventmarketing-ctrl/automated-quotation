import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order placed — Aerovent Fans & Blowers" };

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Order confirmation. Reachable by order number so the buyer can return to it
 * from their email; it shows what was ordered and what happens next. No account
 * needed — the page deliberately shows no other customer's data.
 */
export default async function StoreOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const order = await prisma.storeOrder
    .findUnique({ where: { orderNumber: decodeURIComponent(orderNumber) }, include: { items: true } })
    .catch(() => null);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h1 className="text-lg font-bold text-emerald-900">Order {order.orderNumber} placed</h1>
        <p className="mt-1 text-sm text-emerald-900/80">
          Thank you, {order.buyerName}. We&rsquo;ve recorded your order and sent it to our sales team. Payment options
          appear here once online payment is switched on; in the meantime our team will contact you at{" "}
          <strong>{order.buyerEmail}</strong> to confirm and arrange delivery.
        </p>
      </div>

      <div className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-semibold">What you ordered</div>
        <ul className="divide-y text-sm">
          {order.items.map((it) => (
            <li key={it.id} className="flex justify-between gap-3 px-4 py-2">
              <span>
                {it.name}
                {it.variantKey && it.variantKey !== "default" ? ` (${it.variantKey})` : ""} × {it.qty}
                <span className="ml-1 text-xs text-gray-500">{it.modelCode}</span>
              </span>
              <span className="shrink-0 tabular-nums">{peso(Number(it.lineTotal))}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t px-4 py-2 font-bold">
          <span>Total</span>
          <span className="tabular-nums text-[#ED1C24]">{peso(Number(order.total))}</span>
        </div>
      </div>

      <div className="rounded-lg border p-4 text-sm">
        <div className="font-semibold">Delivery to</div>
        <p className="whitespace-pre-line text-gray-700">{order.deliveryAddress}</p>
        <p className="mt-1 text-xs text-gray-500">{order.buyerPhone}</p>
      </div>

      <Link href="/store" className="inline-block rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50">
        ← Continue shopping
      </Link>
    </div>
  );
}
