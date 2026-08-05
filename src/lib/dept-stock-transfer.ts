/**
 * Inter-department stock transfer bookings for the departmental P&L.
 *
 * Duct hardware (duct angle corner / TDC cleat / S-clip / C-clip) is produced
 * in-house by Fans & Blowers and held in stock. When another production department
 * (typically Duct, using them as fabrication parts) pulls the hardware from stock
 * through the MRF, no money changes hands — but for the departmental P&L it is
 * booked as a SALE for Fans & Blowers and a PURCHASE (expense) for the requesting
 * department, valued at the stock item's unit (production) cost.
 *
 * Detection is by the stock item's NAME (the MRF line itself is free text), matched
 * at the issue-from-stock point where the concrete stock item — hence its unit cost
 * — is already resolved.
 */
import type { Prisma } from "@prisma/client";

/** In-house duct hardware, recognised by the stock item's / requisition line's
 *  name. Word-boundary anchored so unrelated text (e.g. "plastic clip") doesn't
 *  match — only Duct Angle corner / TDC Cleat / S-clip / C-clip. */
const DUCT_HARDWARE_NAME_RE = /\bduct\s*angle\s*corner\b|\btdc\s*cleat\b|\bs\s*-?\s*clip\b|\bc\s*-?\s*clip\b/i;

export function isDuctHardwareStockName(name: string): boolean {
  return DUCT_HARDWARE_NAME_RE.test(name || "");
}

/** Production departments that CONSUME duct hardware as fabrication parts — the
 *  internal transfer credits Fans a sale and the dept a purchase, at cost. Fans is
 *  the seller (excluded). OFFICE is excluded too: Office doesn't consume the
 *  hardware, it RE-SELLS it, so Fans is credited once at that resale (via the sale
 *  split), NOT at the physical Fans→Office stock move — booking both would credit
 *  Fans twice. A blank/unknown dept never books a transfer either (it would credit
 *  Fans a sale with no matching expense and unbalance the P&L). */
const VALID_TO_DEPTS = new Set(["duct", "accessories", "motor"]);

/**
 * Record a Fans → <toDept> transfer when in-house duct hardware is issued from
 * stock to a requesting department. No-op unless the issued stock item is duct
 * hardware, the quantity is positive, and the requestor isn't Fans itself.
 * Fans & Blowers is always the selling department (it produces all duct hardware).
 */
export async function recordDeptStockTransfer(
  tx: Prisma.TransactionClient,
  args: {
    quotationId?: string | null;
    toDept: string;
    stockItemId: string;
    name: string;
    unitCost: number;
    qty: number;
    byName: string;
  },
): Promise<void> {
  if (!(args.qty > 0)) return;
  if (!VALID_TO_DEPTS.has(args.toDept)) return; // Fans's own draw / unknown dept — not a transfer
  if (!isDuctHardwareStockName(args.name)) return;
  const unitCost = Math.max(0, Number(args.unitCost) || 0);
  const value = Math.round(unitCost * args.qty * 100) / 100;
  await tx.deptStockTransfer.create({
    data: {
      quotationId: args.quotationId ?? null,
      fromDept: "fans",
      toDept: args.toDept,
      stockItemId: args.stockItemId,
      description: args.name,
      qty: args.qty,
      unitCost,
      value,
      byName: args.byName,
    },
  });
}
