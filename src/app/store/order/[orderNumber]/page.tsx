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
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10 lg:px-8">
      {paid ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tight text-emerald-900">Payment received — order {order.orderNumber}</h1>
          <p className="mt-1 text-sm text-emerald-900/80">
            Thank you, {order.buyerName}. Your payment is confirmed and your order is with our sales team. We&rsquo;ll
            contact you at <strong>{order.buyerEmail}</strong> to arrange delivery.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tight text-sky-900">Order {order.orderNumber} placed</h1>
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
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13.5px] text-red-800">
          That payment didn&rsquo;t go through. Nothing has been charged — you can try again below.
        </div>
      )}
      {!paid && sp.cancelled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13.5px] text-amber-900">
          Payment was cancelled. Your order is still reserved — you can pay whenever you&rsquo;re ready.
        </div>
      )}
      {!paid && sp.paid && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-[13.5px] text-sky-900">
          We&rsquo;re confirming your payment with the provider. Refresh in a moment — if it stays like this, our team
          will follow it up with you.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50/60 px-4 py-3 font-[family-name:var(--font-display)] text-[13.5px] font-bold text-slate-900">What you ordered</div>
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
        <div className="flex items-baseline justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 font-bold">
          <span>Total</span>
          <span className="font-[family-name:var(--font-display)] text-[20px] font-extrabold tabular-nums tracking-tight text-slate-900">{peso(Number(order.total))}</span>
        </div>
      </div>

      {!paid && (
        <div className="rounded-2xl border border-slate-200 p-5">
          <div className="mb-3 font-[family-name:var(--font-display)] text-[14px] font-bold text-slate-900">Pay for this order</div>
          <PayButtons orderNumber={order.orderNumber} hitpay={hitpayConfigured()} paypal={paypalConfigured()} />
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 p-5 text-sm">
        <div className="font-[family-name:var(--font-display)] text-[13.5px] font-bold text-slate-900">Delivery to</div>
        <p className="whitespace-pre-line text-gray-700">{order.deliveryAddress}</p>
        <p className="mt-1 text-xs text-gray-500">{order.buyerPhone}</p>
      </div>

      <Link href="/store" className="inline-block rounded-full border border-slate-200 px-5 py-2.5 text-[13.5px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50">
        ← Continue shopping
      </Link>
    </div>
  );
}
