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

/** In-house duct hardware, recognised by the stock item's name. */
const DUCT_HARDWARE_NAME_RE = /duct\s*angle\s*corner|tdc\s*cleat|s\s*-?\s*clip|c\s*-?\s*clip/i;

export function isDuctHardwareStockName(name: string): boolean {
  return DUCT_HARDWARE_NAME_RE.test(name || "");
}

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
  if (args.toDept === "fans") return; // Fans drawing its own stock — not a transfer
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
