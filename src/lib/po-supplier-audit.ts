/**
 * Audit purchase orders against the supplier the CATALOGUE names for what they buy.
 *
 * READ ONLY — a diagnostic; nothing here writes.
 *
 * Why it exists: until #560 the PO form chose a line's product by scoring the
 * whole line, specification and all. A Nenutec VAV line carrying
 * `Duct Diameter: 250 mm (10 in)` handed the numbers 250 and 10 to the matcher
 * as if they were model codes, and an unrelated product that happened to carry
 * both outranked the product actually named at the front of the line. The wrong
 * product means the wrong carrier — and because exactly one eligible supplier is
 * what triggers the form's auto-pick, and auto-picking force-overwrites every
 * unit price, it also meant the wrong AMOUNTS. One order was written at ₱3,348
 * against a catalogue value of ₱91,188.
 *
 * The fix corrects new purchase orders. It cannot correct ones already issued,
 * and nothing in the app ever re-checks a PO after it is saved. This is that
 * check, applied after the fact, so the owner has a list to look at rather than
 * a filing cabinet to re-read.
 *
 * **A caveat that must stay attached to every row.** A purchase order records
 * what was actually agreed. Buying from a supplier the catalogue does not list
 * is an ordinary thing to do — a one-off, a stock-out, a better price, a
 * supplier added to Products only later. A row here means *"the catalogue and
 * this PO disagree about who sells this"*, which is worth a look. It is not an
 * accusation, and this audit decides nothing.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getProducts } from "@/lib/product-catalog";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { poBatchId } from "@/lib/purchase-batch";
import { getSuppliers } from "@/lib/suppliers";
import {
  carriersForLines,
  catalogPriceFor,
  sameSupplier,
  type CatalogSupplierRef,
  type CatalogSuppliers,
} from "@/lib/po-catalog";
import { buildPoPriceCatalog } from "@/lib/po-price-catalog";

export interface SupplierIssue {
  /** The PurchaseRequest to open — for a combined PO, its first member. */
  requestId: string;
  poNumber: string;
  /** The order this PO belongs to, for the link; empty for a department requisition. */
  orderId: string;
  date: string;
  /** How many requests this PO covers (more than one = a combined PO). */
  members: number;
  /** The company on the purchase order. */
  supplier: string;
  /** The companies the catalogue names for these lines. */
  carriers: string[];
  /** Lines that resolved to a catalogued product, and the line count. */
  matchedLines: number;
  totalLines: number;
  /** The PO's own line value, and the same lines at the catalogue carrier's prices. */
  poTotal: number;
  catalogueTotal: number | null;
}

export interface SupplierAudit {
  purchaseOrders: number;
  issues: SupplierIssue[];
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function auditPoSuppliers(): Promise<SupplierAudit> {
  const [products, registry, requests, priceCatalog] = await Promise.all([
    getProducts().catch(() => []),
    getSuppliers().catch(() => []),
    prisma.purchaseRequest
      // `po` is a nullable Json column, so "has a PO" is `not: DbNull` — filtering
      // on `null` does not type-check here.
      .findMany({
        where: { po: { not: Prisma.DbNull } },
        select: { id: true, po: true, quotationId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => [] as { id: string; po: unknown; quotationId: string | null; createdAt: Date }[]),
    buildPoPriceCatalog(),
  ]);

  // Product name → the suppliers linked to it, id and name, exactly as the PO
  // form sees it. Same shape, same matcher, so the audit judges what the form
  // judged rather than a second opinion.
  const catalogSuppliers: CatalogSuppliers = {};
  for (const p of products) {
    catalogSuppliers[p.name.trim().toLowerCase()] = p.suppliers
      .filter((s) => s.company)
      .map((s) => ({ id: s.supplierId ?? "", company: s.company }));
  }

  /**
   * The PO stores its supplier as a COMPANY NAME only, so resolve it through the
   * registry first. Without that a supplier renamed since the PO was raised
   * would look like a mismatch on every order it ever appeared on — the audit
   * would report the rename, not the bug.
   */
  const resolve = (company: string): { id: string; company: string } => {
    const hit = registry.find((s) => s.company.trim().toLowerCase() === company.trim().toLowerCase());
    return hit ? { id: hit.id, company: hit.company } : { id: "", company };
  };

  const issues: SupplierIssue[] = [];
  // A combined PO is one document held on every member request (see
  // lib/purchase-batch), so it must be reported once, not once per member.
  const seenBatch = new Map<string, number>();
  let poCount = 0;

  for (const pr of requests) {
    const po = coercePurchaseOrder(pr.po);
    if (!po) continue;
    const batch = poBatchId(pr.po);
    if (batch) {
      const at = seenBatch.get(batch);
      if (at !== undefined) {
        const row = issues[at];
        if (row) row.members++;
        continue;
      }
    }
    poCount++;

    const lines = po.lines.filter((l) => l.description.trim());
    const carriers: CatalogSupplierRef[] = carriersForLines(lines, catalogSuppliers);
    // Nothing catalogued for any line — the audit has no opinion to offer.
    if (carriers.length === 0) continue;

    const supplier = po.supplier?.company ?? "";
    const chosen = resolve(supplier);
    if (carriers.some((ref) => sameSupplier(ref, chosen))) continue; // agrees

    const matchedLines = lines.filter((l) => carriersForLines([l], catalogSuppliers).length > 0).length;
    const poTotal = lines.reduce((t, l) => t + num(l.unitPrice) * num(l.qty), 0);
    /**
     * The same lines at the catalogue carrier's own prices.
     *
     * Null unless EVERY line has a price from that carrier — a partial total
     * read beside the PO's full total is a comparison that misleads, and the
     * number people will act on is the gap between the two.
     */
    const priceAt = (ref: CatalogSupplierRef): number | null => {
      let total = 0;
      for (const l of lines) {
        const p = catalogPriceFor(l.description, ref.company.trim().toLowerCase(), priceCatalog);
        if (p === undefined || p <= 0) return null;
        total += p * num(l.qty);
      }
      return total;
    };
    const catalogueTotal = carriers.reduce<number | null>((acc, ref) => acc ?? priceAt(ref), null);

    if (batch) seenBatch.set(batch, issues.length);
    issues.push({
      requestId: pr.id,
      poNumber: po.poNumber,
      orderId: pr.quotationId ?? "",
      date: po.date,
      members: 1,
      supplier,
      carriers: [...new Set(carriers.map((c) => c.company.trim()).filter(Boolean))],
      matchedLines,
      totalLines: lines.length,
      poTotal: round2(poTotal),
      catalogueTotal: catalogueTotal === null ? null : round2(catalogueTotal),
    });
  }

  // Biggest money gap first — that is the order anyone would work through them
  // in. A row with no comparable total sorts by its own value, so a large PO
  // never hides at the bottom just because its prices could not be rebuilt.
  const weight = (i: SupplierIssue) =>
    i.catalogueTotal === null ? i.poTotal : Math.abs(i.catalogueTotal - i.poTotal);
  issues.sort((a, b) => weight(b) - weight(a));

  return { purchaseOrders: poCount, issues };
}
