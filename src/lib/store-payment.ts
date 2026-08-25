/**
 * Settling a storefront order.
 *
 * Every payment path (HitPay webhook, HitPay return, PayPal capture) funnels
 * through `markStoreOrderPaid`, which is deliberately strict:
 *
 *  - **Idempotent** — a gateway may deliver the same webhook several times, and
 *    the buyer may reload the return URL. An order already PAID is a no-op.
 *  - **Amount-verified** — the amount the gateway actually took must match the
 *    order total (to the centavo). A short payment is never marked paid; it's
 *    flagged for a human instead of silently accepted.
 *  - **Server-sourced** — the total comes from the order row, never from the
 *    request, so a forged callback can't lower the price.
 */
import { prisma } from "@/lib/db";

export type SettleResult =
  | { ok: true; alreadyPaid: boolean; orderNumber: string }
  | { ok: false; reason: string };

/** Tolerance for gateway rounding — payments are exact to the centavo. */
const AMOUNT_EPSILON = 0.01;

export async function markStoreOrderPaid(params: {
  orderNumber: string;
  provider: "hitpay" | "paypal";
  providerRef: string;
  amountPaid: number | null;
  currency?: string | null;
}): Promise<SettleResult> {
  const { orderNumber, provider, providerRef, amountPaid, currency } = params;

  const order = await prisma.storeOrder
    .findUnique({ where: { orderNumber }, select: { id: true, orderNumber: true, status: true, total: true, currency: true } })
    .catch(() => null);
  if (!order) return { ok: false, reason: "order not found" };

  // Already settled — a repeat webhook / reloaded return page.
  if (order.status === "PAID" || order.status === "FULFILLED") {
    return { ok: true, alreadyPaid: true, orderNumber: order.orderNumber };
  }
  if (order.status === "CANCELLED") return { ok: false, reason: "order was cancelled" };

  const expected = Number(order.total);
  if (amountPaid == null) return { ok: false, reason: "gateway reported no amount" };
  if (Math.abs(amountPaid - expected) > AMOUNT_EPSILON) {
    console.error(`store payment mismatch on ${orderNumber}: paid ${amountPaid}, expected ${expected}`);
    return { ok: false, reason: `amount ${amountPaid} does not match the order total ${expected}` };
  }
  if (currency && order.currency && currency.toUpperCase() !== order.currency.toUpperCase()) {
    return { ok: false, reason: `currency ${currency} does not match the order (${order.currency})` };
  }

  // Conditional update: only transitions a still-unpaid row, so two webhooks
  // arriving together can't both "succeed" in settling it.
  const res = await prisma.storeOrder.updateMany({
    where: { id: order.id, status: "PENDING_PAYMENT" },
    data: { status: "PAID", provider, providerRef, paidAt: new Date() },
  });
  return { ok: true, alreadyPaid: res.count === 0, orderNumber: order.orderNumber };
}
