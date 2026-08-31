/**
 * The catalogue approval record, after the fact.
 *
 * The pending card shows who has signed a request *while it is still waiting*.
 * The moment the last signature lands the request applies and the card
 * disappears, so until now the completed record — who approved what, and when —
 * was visible only in the window before it stopped mattering. `ActivityLog` kept
 * a one-line summary, not the signatures.
 *
 * Nothing new is stored for this. `StockAction` and `ProductChange` rows survive
 * their decision with every timestamp on them; they were simply never read back
 * once `status` left PENDING.
 *
 * Both surfaces are normalised to one shape because they are the same event seen
 * from two screens, and a record split across two formats is a record people
 * stop reading.
 */
import type { ProductChangeStatus, StockActionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STOCK_ACTION_LABEL, STOCK_SLOT_LABEL, stockActionSignatures, type StockSlot } from "@/lib/stock-action";
import { PRODUCT_CHANGE_LABEL } from "@/lib/product-change";

/** One signature on the record: the office, the person, the moment. */
export interface ApprovalStep {
  designation: string;
  name: string | null;
  at: string | null;
  signed: boolean;
}

export interface ApprovalRecord {
  id: string;
  source: "inventory" | "products";
  sourceLabel: string;
  /** "Stock adjustment", "Product edit", … */
  kindLabel: string;
  /** The item or product the request was about. */
  title: string;
  summary: string;
  outcome: "applied" | "rejected";
  /** Who raised it, in what capacity, and when. */
  raisedBy: ApprovalStep;
  /** The signatures that followed, in the order the chain took them. */
  steps: ApprovalStep[];
  /** When it was decided — what the list is sorted by. */
  decidedAt: string;
  rejectReason: string | null;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
/** The office a proposer answered for; `proposedRole` is a slot key or "admin". */
const designationFor = (role: string): string =>
  role in STOCK_SLOT_LABEL ? STOCK_SLOT_LABEL[role as StockSlot] : "Admin";

const DECIDED: StockActionStatus[] = ["APPLIED", "REJECTED", "CANCELLED"];
const DECIDED_PRODUCT: ProductChangeStatus[] = ["APPLIED", "REJECTED"];

/**
 * The most recent decided catalogue requests, newest first.
 *
 * `limit` is per surface, then the merged list is trimmed — so a busy Inventory
 * cannot crowd Products out of the record entirely.
 */
export async function getApprovalHistory(limit = 200): Promise<ApprovalRecord[]> {
  const [stock, products] = await Promise.all([
    prisma.stockAction
      .findMany({ where: { status: { in: DECIDED } }, orderBy: { updatedAt: "desc" }, take: limit })
      .catch(() => []),
    prisma.productChange
      .findMany({ where: { status: { in: DECIDED_PRODUCT } }, orderBy: { updatedAt: "desc" }, take: limit })
      .catch(() => []),
  ]);

  const rows: ApprovalRecord[] = [];

  for (const a of stock) {
    const rejected = a.status !== "APPLIED";
    // The same helper the pending card uses, so a request reads identically
    // before and after it is decided — including omitting a step the chain never
    // took (a Purchaser's request has no Warehouse line).
    const steps: ApprovalStep[] = stockActionSignatures({
      proposedRole: a.proposedRole,
      warehouseByName: a.warehouseByName, warehouseAt: iso(a.warehouseAt),
      purchaserByName: a.purchaserByName, purchaserAt: iso(a.purchaserAt),
      approverByName: a.approverByName, approverAt: iso(a.approverAt),
    }).map(({ designation, name, at, signed }) => ({ designation, name, at, signed }));
    if (rejected && a.rejectedByName) {
      steps.push({ designation: "Rejected by", name: a.rejectedByName, at: iso(a.rejectedAt), signed: true });
    }
    rows.push({
      id: a.id,
      source: "inventory",
      sourceLabel: "Inventory",
      kindLabel: STOCK_ACTION_LABEL[a.kind],
      title: a.itemName,
      summary: a.summary,
      outcome: rejected ? "rejected" : "applied",
      raisedBy: {
        designation: designationFor(a.proposedRole),
        name: a.proposedByName,
        at: iso(a.proposedAt),
        signed: true,
      },
      steps,
      decidedAt: iso(a.appliedAt ?? a.rejectedAt ?? a.updatedAt)!,
      rejectReason: a.rejectReason,
    });
  }

  for (const c of products) {
    const rejected = c.status !== "APPLIED";
    rows.push({
      id: c.id,
      source: "products",
      sourceLabel: "Products",
      kindLabel: PRODUCT_CHANGE_LABEL[c.kind],
      title: c.productName,
      summary: c.summary,
      outcome: rejected ? "rejected" : "applied",
      // A product change is only ever raised by someone who is not the price
      // owner — the owner's own save writes straight through and never parks —
      // so the Purchaser is the only proposer this can have.
      raisedBy: { designation: "Purchaser", name: c.proposedByName, at: iso(c.proposedAt), signed: true },
      steps: [{
        designation: rejected ? "Rejected by" : "Admin / Payment Approver",
        name: c.decidedByName,
        at: iso(c.decidedAt),
        signed: c.decidedAt != null,
      }],
      decidedAt: iso(c.decidedAt ?? c.updatedAt)!,
      rejectReason: c.rejectReason,
    });
  }

  return rows.sort((x, y) => y.decidedAt.localeCompare(x.decidedAt)).slice(0, limit);
}
