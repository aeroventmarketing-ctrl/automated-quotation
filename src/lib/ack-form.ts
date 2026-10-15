/**
 * Has an order had its Acknowledgement Form uploaded?
 *
 * The owner, on the Orders list: *"list all order number that have been
 * uploaded with acknowledgement form"*.
 *
 * The Acknowledgement Form is the `or_cr_af` closing-document slot on a
 * VAT-exclusive order (`collectionReceiptLabel(false)`); on a VAT-inclusive
 * order the same slot is the Collection Receipt. It is uploaded on the order,
 * or — for a multiple-batch delivery — on each batch. The unsigned copy made
 * when the delivery documents are prepared rides in `unsigned_or_cr_af`.
 */
import type { SaleDoc } from "@/lib/sale";

export type AckFormState = "signed" | "unsigned" | null;

type Docs = Record<string, SaleDoc[] | undefined> | undefined;

const has = (docs: Docs, key: string) => (docs?.[key]?.length ?? 0) > 0;

/**
 * "signed" — the signed Acknowledgement Form is on the order or on any batch;
 * "unsigned" — only the unsigned copy is; null — none, or not a VAT-exclusive
 * order (its slot is the Collection Receipt, not an Acknowledgement Form).
 */
export function ackFormState(vatMode: string | null | undefined, orderDocs: Docs, batches: { docs?: Docs; cancelled?: boolean }[] = []): AckFormState {
  if (vatMode !== "EXCLUSIVE") return null;
  const all = [orderDocs, ...batches.filter((b) => !b.cancelled).map((b) => b.docs)];
  if (all.some((d) => has(d, "or_cr_af"))) return "signed";
  if (all.some((d) => has(d, "unsigned_or_cr_af"))) return "unsigned";
  return null;
}
