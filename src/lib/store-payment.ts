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
import { handOffStoreOrderToErp } from "@/lib/store-erp";
import { notifyStoreOrderPaid } from "@/lib/store-notify";

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
  const alreadyPaid = res.count === 0;

  // Post-payment work: hand the order to the ERP as a DRAFT counter sale and
  // tell the buyer + the sales team. Only the caller that actually flipped the
  // row does this, so a duplicate webhook doesn't re-send emails.
  //
  // Both steps are best-effort ON PURPOSE: the money has already changed hands,
  // so a failure here must never turn a paid order back into an unpaid one. It
  // is logged, and the order stays PAID for a human to pick up.
  if (!alreadyPaid) {
    let counterSaleId: string | null = null;
    try {
      const handoff = await handOffStoreOrderToErp(order.orderNumber);
      if (handoff.ok) counterSaleId = handoff.counterSaleId;
      else console.error(`store ERP handoff skipped for ${order.orderNumber}: ${handoff.reason}`);
    } catch (e) {
      console.error(`store ERP handoff threw for ${order.orderNumber}`, e);
    }
    await notifyStoreOrderPaid(order.orderNumber, counterSaleId);
  }

  return { ok: true, alreadyPaid, orderNumber: order.orderNumber };
}
