"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { priceCart, type CartLine, type PricedCart } from "@/lib/store-cart";

/**
 * Storefront server actions. These are PUBLIC (shoppers have no account), so
 * every one of them re-derives prices from the catalogue and never trusts a
 * figure sent by the browser.
 */

/** Price a browser cart for display. */
export async function priceCartAction(lines: CartLine[]): Promise<PricedCart> {
  return priceCart(lines);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CheckoutDetails {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  company?: string;
  deliveryAddress: string;
  notes?: string;
}

export type PlaceOrderResult =
  | { ok: true; orderNumber: string; total: number }
  | { ok: false; message: string };

/** Claim the next storefront order number ("WEB-10001"). Runs in a transaction. */
async function nextStoreOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const KEY = "store_order_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const cur = typeof (row?.value as { n?: unknown } | null)?.n === "number" ? (row!.value as { n: number }).n : 10000;
  const n = cur + 1;
  await tx.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { n } as Prisma.InputJsonValue },
    update: { value: { n } as Prisma.InputJsonValue },
  });
  return `WEB-${n}`;
}

/**
 * Place a storefront order. The cart is re-priced server-side and the resulting
 * lines are snapshotted onto the order, so the amount owed is decided here — not
 * by the browser. The order starts PENDING_PAYMENT; the payment step (HitPay /
 * PayPal) attaches to it next.
 */
export async function placeOrder(lines: CartLine[], details: CheckoutDetails): Promise<PlaceOrderResult> {
  const name = (details.buyerName ?? "").trim();
  const email = (details.buyerEmail ?? "").trim();
  const phone = (details.buyerPhone ?? "").trim();
  const address = (details.deliveryAddress ?? "").trim();
  if (!name) return { ok: false, message: "Enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, message: "Enter a valid email address." };
  if (!phone) return { ok: false, message: "Enter a contact number." };
  if (!address) return { ok: false, message: "Enter a delivery address." };

  const cart = await priceCart(lines);
  if (cart.lines.length === 0) return { ok: false, message: "Your cart is empty." };

  try {
    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await nextStoreOrderNumber(tx);
      return tx.storeOrder.create({
        data: {
          orderNumber,
          buyerName: name,
          buyerEmail: email,
          buyerPhone: phone,
          company: (details.company ?? "").trim() || null,
          deliveryAddress: address,
          notes: (details.notes ?? "").trim() || null,
          currency: cart.currency,
          subtotal: cart.subtotal,
          total: cart.total,
          items: {
            create: cart.lines.map((l) => ({
              catalogueItemId: l.catalogueItemId,
              modelCode: l.modelCode,
              name: l.name,
              variantKey: l.variantKey,
              unit: l.unit,
              qty: l.qty,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
            })),
          },
        },
        select: { orderNumber: true, total: true },
      });
    });
    return { ok: true, orderNumber: order.orderNumber, total: Number(order.total) };
  } catch (e) {
    console.error("placeOrder failed", e);
    return { ok: false, message: "Could not place the order. Please try again." };
  }
}
