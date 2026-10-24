/**
 * Which inventory rows a requisition / MRF line is, for ISSUING from stock.
 *
 * The owner, on a Fans & Blower requisition: *"In inventory tab Nihonbond #16 has
 * 30pcs in stock but when checking for in stock availability and issue it shows
 * out of stock."* The line was `15 pcs · NIHONBOND #16 (1.3mm) (For angle
 * corner)`, SKU CON000473. The badge beside it said "30 pc in stock" — it
 * matches by code, then exact name. The issue panel matched by name with EVERY
 * bracket deleted, so "NIHONBOND #16 (1.3mm)" and "NIHONBOND #16 (1.2mm)" were
 * the same "nihonbond #16", and it took the first: the 1.2mm, with none left.
 * Pressing Issue would have deducted the wrong item.
 *
 * So, the badge's rules (`onHandFor`), returning the rows rather than a total:
 *
 *   1. the line's item code (`PurchaseRequest.itemSkus`) — exact;
 *   2. the exact name, after peeling only a trailing remark / spec segment
 *      (`skuNameCandidates`) — "(1.3mm)" is part of the item, "(For angle
 *      corner)" is not;
 *   3. only then the old bracket-blind name — and only when every row it finds
 *      is ONE item (the same name, at several locations). Two different items
 *      that differ only inside brackets are never guessed between.
 *
 * Returns every location's row of the item; `pickIssueRow` chooses the location.
 * Pure.
 */
import { normalizeItemName, skuNameCandidates } from "./item-sku";

const normCode = (s: string | null | undefined): string => String(s ?? "").trim().toUpperCase();
const bracketBlind = (s: string) => s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

export function stockRowsForLine<T extends { name: string; sku?: string | null }>(
  description: string | null | undefined,
  code: string | null | undefined,
  stock: readonly T[],
): T[] {
  const c = normCode(code);
  if (c) {
    const byCode = stock.filter((s) => normCode(s.sku) === c);
    if (byCode.length) return byCode;
  }
  for (const name of skuNameCandidates(description)) {
    const key = normalizeItemName(name);
    const byName = stock.filter((s) => normalizeItemName(s.name) === key);
    if (byName.length) return byName;
  }
  const loose = bracketBlind(String(description ?? ""));
  if (!loose) return [];
  const rows = stock.filter((s) => bracketBlind(s.name) === loose);
  const distinct = new Set(rows.map((r) => normalizeItemName(r.name)));
  return distinct.size === 1 ? rows : [];
}
