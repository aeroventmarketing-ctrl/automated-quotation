/**
 * `Quotation.classification`, minus the parts no confirmed-order reader opens.
 *
 * ## What the column actually holds
 *
 * One JSONB column carries several unrelated things: the sale record, the order
 * workflow, and a pile of history. The seven screens that scan *every confirmed
 * order* — the approver alarm, My Dashboard, the Management Dashboard and its
 * finance-monitor twin, receivables, commissions and production status — open
 * only `sale` and `workflow` (and, for commissions, the VAT-exempt total).
 *
 * The heaviest thing none of them opens is **`revisions`**. Every time a
 * quotation is revised the builder appends a full snapshot, including
 * `fullLines` — *"full per-line content (incl. specs) for an exact restore"*. An
 * order revised three times carries three complete copies of its line items.
 * Measured on a representative fixture: **14 kB of `classification` per order,
 * of which 429 bytes is what these readers actually read.**
 *
 * ## Why subtract rather than select
 *
 * `-` on a `jsonb` column removes keys and leaves everything else exactly as it
 * was. Selecting `classification->'sale'` instead would be a whitelist, and a
 * whitelist goes stale silently: add a key to `classification` next month, and a
 * reader that quietly needs it starts getting `undefined` with nothing to show
 * for it. Subtracting a blacklist fails the safe way round — a new key arrives,
 * and the worst case is that it is bigger than it needed to be.
 *
 * Measured both ways, too: subtracting the nine cost **147** shared buffers
 * against **181** for extracting the two, and landed within eleven bytes of the
 * same wire size. The safer shape was also the cheaper one.
 *
 * ## Why a separate query rather than raw SQL in each reader
 *
 * The readers select different columns, and several carry `Decimal` money that
 * Prisma maps for them. Rewriting six `findMany`s as raw SQL would put that
 * conversion — and every relation include — at risk for a saving that lives
 * entirely in one column. So the Prisma query stays exactly as it was, minus
 * `classification`, and this fetches the slim version alongside it.
 *
 * It takes no arguments and applies the same `sale.po` filter every caller
 * already uses, so it can run **in parallel** with the reader's own query rather
 * than waiting on a list of ids. And it is memoised per request, so a page that
 * draws several of these cards — My Dashboard draws four — pays for it once.
 */
import { cache } from "react";
import { prisma } from "@/lib/db";

/**
 * The keys no confirmed-order reader opens. Verified one file at a time against
 * all seven readers before any of this was written.
 *
 * They belong to the quotation builder and the document panels, which load a
 * single order by id and are welcome to the whole blob.
 */
export const UNREAD_CLASSIFICATION_KEYS = [
  "revisions",
  "revision",
  "revisionRestore",
  "revisionRestores",
  "saleDocReads",
  "saleDocReadCounts",
  "depositSlipReads",
  "slipValidations",
  "workflowResets",
];

/**
 * Slimmed `classification` for every confirmed order, keyed by quotation id.
 *
 * The `where` is the same necessary condition the readers use: `isSaleConfirmed`
 * returns false without a PO, so this cannot miss an order any of them would
 * have kept. A reader with a narrower filter of its own (commissions scopes to
 * one salesperson) simply looks up fewer of these — extra entries cost nothing.
 */
export const slimClassificationByOrder = cache(async function slimClassificationByOrder(): Promise<
  Map<string, unknown>
> {
  const rows = await prisma.$queryRaw<{ id: string; classification: unknown }[]>`
    select "id", "classification" - ${UNREAD_CLASSIFICATION_KEYS}::text[] as "classification"
    from "Quotation"
    where "classification" #> '{sale,po}' is not null
  `;
  return new Map(rows.map((r) => [r.id, r.classification]));
});

/**
 * Put the slimmed `classification` back on a row that was selected without it,
 * so the loop that follows reads exactly as it did before.
 *
 * This is what keeps the diff in six readers down to two lines each. Their loops
 * pass the row around — `payableTotal(q)` and `netOfVat(q, …)` both reach into
 * `q.classification` for the VAT-exempt total — so handing the classification
 * back on the row is safer than finding every place that reads it.
 *
 * A missing entry becomes `null`, which is what the row would look like if the
 * order had no classification at all: `saleFromClassification(null)` is null and
 * the reader's own `isSaleConfirmed` gate drops it. That can only happen in the
 * gap between the two queries — an order confirmed after this map was built and
 * before the reader's own query ran — and the effect is that it appears on the
 * next render instead of this one. Exactly what happened before, when the two
 * halves of the read were one query that ran at one of the two moments anyway.
 */
export function withSlimClassification<T extends { id: string }>(
  row: T,
  slim: Map<string, unknown>,
): T & { classification: unknown } {
  return { ...row, classification: slim.get(row.id) ?? null };
}
