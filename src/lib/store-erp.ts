/**
 * Storefront → ERP handoff (Phase B5).
 *
 * A PAID store order becomes a **DRAFT counter sale**, so a web sale is the same
 * kind of record as a walk-in and flows into the existing sales reports, P&L and
 * commission logic instead of sitting in a separate island.
 *
 * Deliberately DRAFT, not completed: completing a counter sale is what issues
 * stock, and that stays a human step. The warehouse opens the draft and completes
 * it through the normal flow, at which point inventory moves and the sale number
 * is claimed. That means an oversold or mis-matched line is caught by a person
 * before stock is touched.
 *
 * Idempotent: an order that already carries a `counterSaleId` is left alone, so
 * a repeated webhook can't create duplicate sales.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stockForCatalogueMany } from "@/lib/store-stock";

/** The counter sale's VAT mode — website prices are VAT-inclusive. */
const STORE_VAT_MODE = "INCLUSIVE";
/**
 * `soldById` on a counter sale records who keyed it in; nobody did here. It has
 * no foreign key and is read for exactly one rule — "only the person who started
 * this draft, or an admin, may discard it" — so this sentinel means a web
 * order's draft can only be discarded by an ADMIN, never silently by whichever
 * staff member happens to open it. That's the behaviour we want.
 */
const STORE_SOLD_BY_ID = "online-store";
/** Payment method recorded on the sale, by gateway. */
const METHOD_LABEL: Record<string, string> = { hitpay: "Online (HitPay)", paypal: "Online (PayPal)" };

export type HandoffResult =
  | { ok: true; counterSaleId: string; created: boolean }
  | { ok: false; reason: string };

/**
 * Find or create the Customer for a web buyer. Matched on email (the only stable
 * identifier a storefront collects); a repeat buyer therefore accumulates history
 * on one client record rather than spawning a new one per order.
 */
async function resolveWebCustomer(
  tx: Prisma.TransactionClient,
  order: { buyerName: string; buyerEmail: string; buyerPhone: string; company: string | null; deliveryAddress: string },
): Promise<string> {
  const email = order.buyerEmail.trim();
  const existing = email
    ? await tx.customer.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })
    : null;
  if (existing) return existing.id;

  const created = await tx.customer.create({
    data: {
      // A walk-in-style buyer may give no company — fall back to their name so
      // the client list never shows a blank row.
      company: order.company?.trim() || order.buyerName.trim(),
      contactName: order.buyerName.trim() || null,
      email: email || null,
      phone: order.buyerPhone.trim() || null,
      address: order.deliveryAddress.trim() || null,
      notes: "Created from an online store order.",
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Create the draft counter sale for a paid store order. Safe to call more than
 * once — the second call returns the existing sale.
 */
export async function handOffStoreOrderToErp(orderNumber: string): Promise<HandoffResult> {
  const order = await prisma.storeOrder
    .findUnique({ where: { orderNumber }, include: { items: true } })
    .catch(() => null);
  if (!order) return { ok: false, reason: "order not found" };
  if (order.status !== "PAID" && order.status !== "FULFILLED") return { ok: false, reason: "order is not paid" };
  if (order.counterSaleId) return { ok: true, counterSaleId: order.counterSaleId, created: false };
  if (order.items.length === 0) return { ok: false, reason: "order has no items" };

  // Link each line to its stock item where one exists, so completing the sale
  // issues from inventory. An unmatched line still sells — it just carries no
  // stock movement (same as a hand-typed counter-sale line).
  const stock = await stockForCatalogueMany(order.items.map((i) => ({ modelCode: i.modelCode, name: i.name })));

  try {
    const counterSaleId = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: two webhooks racing must not both create.
      const fresh = await tx.storeOrder.findUnique({ where: { id: order.id }, select: { counterSaleId: true } });
      if (fresh?.counterSaleId) return fresh.counterSaleId;

      const customerId = await resolveWebCustomer(tx, order);
      const sale = await tx.counterSale.create({
        data: {
          customerId,
          vatMode: STORE_VAT_MODE,
          status: "DRAFT",
          soldById: STORE_SOLD_BY_ID,
          soldByName: `Online store (${order.orderNumber})`,
          subtotal: order.subtotal,
          vat: 0, // VAT is derived from the inclusive total by the counter-sale totals
          total: order.total,
          // The money is already in — record it so the draft reflects reality.
          amountPaid: order.total,
          paymentMethod: METHOD_LABEL[order.provider ?? ""] ?? "Online",
          notes: [
            `Online store order ${order.orderNumber}.`,
            order.provider ? `Paid via ${order.provider}${order.providerRef ? ` (${order.providerRef})` : ""}.` : null,
            `Deliver to: ${order.deliveryAddress}`,
            order.notes ? `Buyer note: ${order.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          items: {
            create: order.items.map((it, i) => ({
              stockItemId: stock.get(it.modelCode)?.stockItemId ?? null,
              description: it.variantKey && it.variantKey !== "default" ? `${it.name} (${it.variantKey})` : it.name,
              unit: it.unit,
              qty: it.qty,
              unitPrice: it.unitPrice,
              lineTotal: it.lineTotal,
              sortOrder: i,
            })),
          },
        },
        select: { id: true },
      });

      await tx.storeOrder.update({ where: { id: order.id }, data: { counterSaleId: sale.id } });
      return sale.id;
    });

    return { ok: true, counterSaleId, created: true };
  } catch (e) {
    console.error(`store ERP handoff failed for ${orderNumber}`, e);
    return { ok: false, reason: e instanceof Error ? e.message : "handoff failed" };
  }
}
