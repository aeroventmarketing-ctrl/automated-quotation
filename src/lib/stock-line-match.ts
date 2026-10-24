/**
 * Which inventory rows a requisition line is, for ISSUING from stock — by SKU
 * and nothing else.
 *
 * The owner, on a Fans & Blower requisition: *"In inventory tab Nihonbond #16 has
 * 30pcs in stock but when checking for in stock availability and issue it shows
 * out of stock."* The line was `15 pcs · NIHONBOND #16 (1.3mm) (For angle
 * corner)`, SKU CON000473. The issue panel matched by name with every bracket
 * deleted, so NIHONBOND #16 (1.2mm) and (1.3mm) were the same "nihonbond #16",
 * and it took the 1.2mm, with none left — Issue would have deducted the wrong
 * item. Then: *"Match by SKU only, do not use anything else. We always upload
 * products with SKU for further confusions."*
 *
 * So the line's SKU — the one printed beside it: its recorded
 * `PurchaseRequest.itemSkus`, or the catalogue code the SKU chip shows — picks
 * the stock rows with exactly that SKU (one per location; `pickIssueRow` chooses
 * the location). No SKU, or a SKU no stock item carries → no match, and the
 * panel says so rather than guessing by name. Same rule as the "in stock" badge
 * (`onHandFor`), so the two can't disagree. Pure.
 */
const normCode = (s: string | null | undefined): string => String(s ?? "").trim().toUpperCase();

export function stockRowsForLine<T extends { sku?: string | null }>(code: string | null | undefined, stock: readonly T[]): T[] {
  const c = normCode(code);
  return c ? stock.filter((s) => normCode(s.sku) === c) : [];
}
