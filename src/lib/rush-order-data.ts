/**
 * Server side of the RUSH stamp on a printed PO (lib/rush-order): is a request on
 * this PO — the request itself, or any member of a combined PO — for a RUSH
 * order still open? Reads only the three classification keys the stamp needs.
 *
 * The PO goes to the supplier, so it says just **"RUSH"** — no client due date
 * (the owner: *"Put the word 'RUSH' but no date"*). The Job Orders and the MRF,
 * which stay in-house, keep "RUSH ORDER — due …".
 */
export const PO_RUSH_STAMP = "RUSH";

import { prisma } from "@/lib/db";
import { poMemberIds } from "@/lib/purchase-batch";
import { rushStampText } from "@/lib/rush-order";

export async function rushStampForPurchase(pr: { quotationId: string | null; po: unknown }): Promise<string | null> {
  try {
    const members = poMemberIds(pr.po);
    const memberOrders = members.length
      ? (await prisma.purchaseRequest.findMany({ where: { id: { in: members } }, select: { quotationId: true } })).map((m) => m.quotationId)
      : [];
    const ids = [...new Set([pr.quotationId, ...memberOrders].filter((q): q is string => !!q))];
    if (ids.length === 0) return null;
    const rows = await prisma.$queryRaw<{ c: unknown }[]>`
      select jsonb_build_object(
        'rush', "classification" -> 'rush',
        'clientDue', "classification" -> 'clientDue',
        'workflow', jsonb_build_object('stage', "classification" -> 'workflow' -> 'stage')
      ) as "c"
      from "Quotation" where "id" = any(${ids})`;
    for (const r of rows) {
      if (rushStampText(r.c)) return PO_RUSH_STAMP;
    }
    return null;
  } catch {
    return null; // a PO without the stamp beats no PO
  }
}
