import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { hitpayConfigured } from "@/lib/payments/hitpay";
import { paypalConfigured } from "@/lib/payments/paypal";
import { PayButtons } from "./pay-buttons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order placed — Aerovent Fans & Blowers" };

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Order confirmation. Reachable by order number so the buyer can return to it
 * from their email; it shows what was ordered and what happens next. No account
 * needed — the page deliberately shows no other customer's data.
 */
export default async function StoreOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ paid?: string; payfailed?: string; cancelled?: string }>;
}) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const order = await prisma.storeOrder
    .findUnique({ where: { orderNumber: decodeURIComponent(orderNumber) }, include: { items: true } })
    .catch(() => null);
  if (!order) notFound();

  const paid = order.status === "PAID" || order.status === "FULFILLED";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {paid ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <h1 className="text-lg font-bold text-emerald-900">Payment received — order {order.orderNumber}</h1>
          <p className="mt-1 text-sm text-emerald-900/80">
            Thank you, {order.buyerName}. Your payment is confirmed and your order is with our sales team. We&rsquo;ll
            contact you at <strong>{order.buyerEmail}</strong> to arrange delivery.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <h1 className="text-lg font-bold text-sky-900">Order {order.orderNumber} placed</h1>
          <p className="mt-1 text-sm text-sky-900/80">
            Thank you, {order.buyerName}. Your order is reserved — complete the payment below to confirm it. We&rsquo;ll
            email <strong>{order.buyerEmail}</strong> once it&rsquo;s through.
          </p>
        </div>
      )}

      {/* A payment attempt that came back without settling. `paid=1` needs no
          banner: either the order shows PAID above, or the webhook is still in
          flight and a refresh will show it. */}
      {!paid && sp.payfailed && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          That payment didn&rsquo;t go through. Nothing has been charged — you can try again below.
        </div>
      )}
      {!paid && sp.cancelled && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Payment was cancelled. Your order is still reserved — you can pay whenever you&rsquo;re ready.
        </div>
      )}
      {!paid && sp.paid && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          We&rsquo;re confirming your payment with the provider. Refresh in a moment — if it stays like this, our team
          will follow it up with you.
        </div>
      )}

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

      {!paid && (
        <div className="rounded-lg border p-4">
          <div className="mb-2 text-sm font-semibold">Pay for this order</div>
          <PayButtons orderNumber={order.orderNumber} hitpay={hitpayConfigured()} paypal={paypalConfigured()} />
        </div>
      )}

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
