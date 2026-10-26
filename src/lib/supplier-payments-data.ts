import { prisma } from "@/lib/db";
import { coerceSupplierPayments, type SupplierPayment } from "@/lib/supplier-payments";

/**
 * The supplier payments recorded on these purchase requests — one raw read.
 *
 * Raw SQL on purpose: `supplierPayments` (migration 0061) is not in the Prisma
 * model, so no existing PurchaseRequest query can break while the migration is
 * still to be applied. Until it is, this returns an empty map and `ready: false`.
 */
export async function supplierPaymentsFor(ids: string[]): Promise<{ byId: Map<string, SupplierPayment[]>; ready: boolean }> {
  const byId = new Map<string, SupplierPayment[]>();
  if (ids.length === 0) return { byId, ready: true };
  try {
    const rows = await prisma.$queryRaw<{ id: string; supplierPayments: unknown }[]>`
      select "id", "supplierPayments" from "PurchaseRequest" where "id" = any(${ids})
    `;
    for (const r of rows) {
      const list = coerceSupplierPayments(r.supplierPayments);
      if (list.length) byId.set(r.id, list);
    }
    return { byId, ready: true };
  } catch {
    return { byId, ready: false };
  }
}
