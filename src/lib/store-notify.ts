/**
 * Storefront order emails (Phase B5) — the buyer's receipt and the sales team's
 * heads-up. Without these, a paid web order is invisible until someone happens
 * to look in the database.
 *
 * Sent through the same Resend client as everything else, and degrade quietly:
 * a mail failure must never roll back or block a payment that already succeeded,
 * so every send here is best-effort and logged rather than thrown.
 */
import { prisma } from "@/lib/db";
import { config, COMPANY } from "@/lib/config";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { getWorkflowRoles, usersWithWorkflowRole } from "@/lib/workflow-roles";

const peso = (n: number) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface OrderForEmail {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  company: string | null;
  deliveryAddress: string;
  notes: string | null;
  total: number;
  provider: string | null;
  items: { name: string; variantKey: string; qty: number; lineTotal: number; modelCode: string }[];
}

function itemLines(o: OrderForEmail): string {
  return o.items
    .map((i) => {
      const variant = i.variantKey && i.variantKey !== "default" ? ` (${i.variantKey})` : "";
      return `  • ${i.name}${variant} × ${i.qty} — ${peso(i.lineTotal)}  [${i.modelCode}]`;
    })
    .join("\n");
}

/** Receipt to the buyer, once their payment is confirmed. */
async function emailBuyer(o: OrderForEmail): Promise<void> {
  const text =
    `Hi ${o.buyerName},\n\n` +
    `Thank you — we've received your payment for order ${o.orderNumber}.\n\n` +
    `What you ordered\n${itemLines(o)}\n\nTotal paid: ${peso(o.total)}\n\n` +
    `Delivering to\n${o.deliveryAddress}\n\n` +
    `Our team will contact you shortly to arrange the delivery schedule. You can view this order any time at:\n` +
    `${config.appUrl.replace(/\/+$/, "")}/store/order/${encodeURIComponent(o.orderNumber)}\n\n` +
    `Questions? Reply to this email or call ${COMPANY.landline}.\n\n` +
    `${COMPANY.name}\n${COMPANY.website}`;

  await sendEmail({
    from: config.followUpFromEmail!,
    to: o.buyerEmail,
    subject: `${COMPANY.name} — order ${o.orderNumber} confirmed`,
    text,
  });
}

/** Heads-up to whoever handles sales, so a web order doesn't sit unnoticed. */
async function emailSalesTeam(o: OrderForEmail, counterSaleId: string | null): Promise<void> {
  const recipients = await storeAlertRecipients();
  if (recipients.length === 0) return;

  const base = config.appUrl.replace(/\/+$/, "");
  const text =
    `A new PAID order came in from the online store.\n\n` +
    `Order:    ${o.orderNumber}\n` +
    `Buyer:    ${o.buyerName}${o.company ? ` (${o.company})` : ""}\n` +
    `Contact:  ${o.buyerEmail} · ${o.buyerPhone}\n` +
    `Paid via: ${o.provider ?? "online"}\n` +
    `Total:    ${peso(o.total)}\n\n` +
    `Items\n${itemLines(o)}\n\n` +
    `Deliver to\n${o.deliveryAddress}\n` +
    (o.notes ? `\nBuyer note: ${o.notes}\n` : "") +
    `\nA DRAFT counter sale has been created${counterSaleId ? "" : " (FAILED — create it by hand)"}.\n` +
    (counterSaleId ? `Open it to check the items and complete it to issue the stock:\n${base}/counter-sales/${counterSaleId}\n` : "") +
    `\nStore order: ${base}/store/order/${encodeURIComponent(o.orderNumber)}`;

  await sendEmail({
    from: config.followUpFromEmail!,
    to: recipients.join(", "),
    subject: `New online order ${o.orderNumber} — ${peso(o.total)}`,
    text,
  });
}

/**
 * Who gets the new-order alert: everyone holding the `accounting` or
 * `logistics` workflow role, plus every admin — the people who'd act on it.
 */
async function storeAlertRecipients(): Promise<string[]> {
  try {
    const roles = await getWorkflowRoles();
    const ids = new Set<string>([
      ...usersWithWorkflowRole(roles, "accounting"),
      ...usersWithWorkflowRole(roles, "logistics"),
    ]);
    const users = await prisma.user.findMany({
      where: { OR: [{ id: { in: [...ids] } }, { role: "ADMIN" }] },
      select: { email: true },
    });
    return [...new Set(users.map((u) => u.email).filter((e): e is string => !!e))];
  } catch (e) {
    console.error("store alert recipients failed", e);
    return [];
  }
}

/**
 * Send both emails for a paid order. Best-effort: never throws, so a mail
 * problem can't disturb a payment that has already gone through.
 */
export async function notifyStoreOrderPaid(orderNumber: string, counterSaleId: string | null): Promise<void> {
  if (!emailConfigured() || !config.followUpFromEmail) return;
  try {
    const row = await prisma.storeOrder.findUnique({ where: { orderNumber }, include: { items: true } });
    if (!row) return;
    const o: OrderForEmail = {
      orderNumber: row.orderNumber,
      buyerName: row.buyerName,
      buyerEmail: row.buyerEmail,
      buyerPhone: row.buyerPhone,
      company: row.company,
      deliveryAddress: row.deliveryAddress,
      notes: row.notes,
      total: Number(row.total),
      provider: row.provider,
      items: row.items.map((i) => ({
        name: i.name,
        variantKey: i.variantKey,
        qty: i.qty,
        lineTotal: Number(i.lineTotal),
        modelCode: i.modelCode,
      })),
    };
    // Independent sends — one failing must not stop the other.
    await Promise.allSettled([emailBuyer(o), emailSalesTeam(o, counterSaleId)]);
  } catch (e) {
    console.error(`store order notification failed for ${orderNumber}`, e);
  }
}
