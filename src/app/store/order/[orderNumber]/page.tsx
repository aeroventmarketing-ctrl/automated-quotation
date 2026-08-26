import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { hitpayConfigured } from "@/lib/payments/hitpay";
import { paypalConfigured } from "@/lib/payments/paypal";
import { peso } from "@/lib/store-product";
import { DISPLAY, KICKER } from "@/lib/store-ui";
import { PayButtons } from "./pay-buttons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order placed — Aerovent Fans & Blowers" };

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
    <div className="mx-auto w-[min(720px,calc(100%_-_28px))] space-y-5 py-12">
      {paid ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-6">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">Payment received</div>
          <h1 className={`${DISPLAY} mt-2 text-[34px] leading-none text-emerald-900`}>Order {order.orderNumber}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-emerald-900/80">
            Thank you, {order.buyerName}. Your payment is confirmed and your order is with our sales team. We&rsquo;ll
            contact you at <strong>{order.buyerEmail}</strong> to arrange delivery.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-[var(--store-line)] bg-white p-6">
          <div className={KICKER}>Order reserved</div>
          <h1 className={`${DISPLAY} mt-2 text-[34px] leading-none`}>Order {order.orderNumber}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#536275]">
            Thank you, {order.buyerName}. Your order is reserved — complete the payment below to confirm it. We&rsquo;ll
            email <strong>{order.buyerEmail}</strong> once it&rsquo;s through.
          </p>
        </div>
      )}

      {/* A payment attempt that came back without settling. `paid=1` needs no
          banner: either the order shows PAID above, or the webhook is still in
          flight and a refresh will show it. */}
      {!paid && sp.payfailed && (
        <div className="rounded border-l-2 border-[var(--store-accent)] bg-[#fdf2f3] p-4 text-[13.5px] text-[#8b1d24]">
          That payment didn&rsquo;t go through. Nothing has been charged — you can try again below.
        </div>
      )}
      {!paid && sp.cancelled && (
        <div className="rounded border-l-2 border-amber-500 bg-amber-50 p-4 text-[13.5px] text-amber-900">
          Payment was cancelled. Your order is still reserved — you can pay whenever you&rsquo;re ready.
        </div>
      )}
      {!paid && sp.paid && (
        <div className="rounded border-l-2 border-sky-500 bg-sky-50 p-4 text-[13.5px] text-sky-900">
          We&rsquo;re confirming your payment with the provider. Refresh in a moment — if it stays like this, our team
          will follow it up with you.
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-[var(--store-line)] bg-white">
        <div className="border-b border-[var(--store-line)] bg-[#f8fafb] px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--store-steel)]">
          What you ordered
        </div>
        <ul className="divide-y divide-[#edf0f2] text-[13.5px]">
          {order.items.map((it) => (
            <li key={it.id} className="flex justify-between gap-3 px-4 py-2.5">
              <span>
                {it.name}
                {it.variantKey && it.variantKey !== "default" ? ` (${it.variantKey})` : ""} × {it.qty}
                <span className="ml-1.5 text-[11px] text-[#8a96a5]">{it.modelCode}</span>
              </span>
              <span className="shrink-0 tabular-nums">{peso(Number(it.lineTotal))}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-[var(--store-line)] bg-[#f8fafb] px-4 py-3">
          <span className="text-[13px] text-[var(--store-steel)]">Total</span>
          <span className={`${DISPLAY} text-[26px] leading-none tabular-nums`}>{peso(Number(order.total))}</span>
        </div>
      </div>

      {!paid && (
        <div className="rounded-md border border-[var(--store-line)] bg-white p-5">
          <div className={`${DISPLAY} mb-3 text-[22px] leading-none`}>Pay for this order</div>
          <PayButtons orderNumber={order.orderNumber} hitpay={hitpayConfigured()} paypal={paypalConfigured()} />
        </div>
      )}

      <div className="rounded-md border border-[var(--store-line)] bg-white p-5 text-[13.5px]">
        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--store-steel)]">Delivery to</div>
        <p className="mt-2 whitespace-pre-line text-[#536275]">{order.deliveryAddress}</p>
        <p className="mt-1 text-[12px] text-[#8a96a5]">{order.buyerPhone}</p>
      </div>

      <Link
        href="/store#products"
        className="inline-block rounded-[5px] border border-[var(--store-line)] bg-white px-5 py-3 text-[13.5px] font-extrabold transition-colors hover:border-[var(--store-accent)] hover:text-[var(--store-accent)]"
      >
        ← Continue shopping
      </Link>
    </div>
  );
}
