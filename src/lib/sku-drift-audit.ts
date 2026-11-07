/**
 * Admin → Data check: purchase requests whose stored per-line codes contradict
 * their lines — the drift the owner found on PO-AFBM20260001051 (lib/item-sku-
 * align), left behind by edits, splits and partial issues made before they kept
 * the codes in step. Each is listed with what the code is and what the line's
 * own name says it should be; the PO's lines are checked the same way, since a
 * PO prepared from a drifted request copied its codes.
 *
 * Only clear contradictions count (a line whose name is a catalogue item with a
 * different code). Server-only.
 */
import { prisma } from "@/lib/db";
import { buildCatalogueSkuIndex } from "@/lib/pr-item-skus";
import { correctSkus, checkArticleSku } from "@/lib/item-sku-align";
import { coercePurchaseOrder, type POLine } from "@/lib/purchase-order";
import { requisitionDeptLabel } from "@/lib/order-workflow";
import type { SkuIndex } from "@/lib/item-sku";

export interface SkuDriftIssue {
  prId: string;
  label: string;
  href: string;
  status: string;
  poNumber: string | null;
  /** Request lines whose stored code is another item's. */
  fixes: { line: number; item: string; from: string; to: string }[];
  /** PO lines carrying another item's code. */
  poFixes: { line: number; description: string; from: string; to: string }[];
}

/** The PO's lines with every clearly wrong code corrected, and what changed. */
export function correctPoLineSkus(lines: readonly POLine[], index: SkuIndex): { lines: POLine[]; fixed: SkuDriftIssue["poFixes"] } {
  const fixed: SkuDriftIssue["poFixes"] = [];
  const out = lines.map((l, i) => {
    const c = checkArticleSku(l.description, l.sku, index);
    if (c.status !== "mismatch") return l;
    fixed.push({ line: i, description: l.description, from: c.stored, to: c.expected });
    return { ...l, sku: c.expected };
  });
  return { lines: out, fixed };
}

export async function auditSkuDrift(): Promise<{ checked: number; issues: SkuDriftIssue[] }> {
  const [prs, index] = await Promise.all([
    prisma.purchaseRequest.findMany({
      select: { id: true, status: true, dept: true, quotationId: true, items: true, itemSkus: true, po: true, quotation: { select: { quoteNumber: true } } },
      orderBy: { createdAt: "desc" },
    }),
    buildCatalogueSkuIndex(),
  ]);
  const issues: SkuDriftIssue[] = [];
  for (const pr of prs) {
    const items = Array.isArray(pr.items) ? (pr.items as unknown[]).map(String) : [];
    const skus = Array.isArray(pr.itemSkus) ? (pr.itemSkus as unknown[]) : null;
    const req = skus ? correctSkus(items, skus, index).fixed : [];
    const po = coercePurchaseOrder(pr.po);
    const poFix = po ? correctPoLineSkus(po.lines, index).fixed : [];
    if (req.length === 0 && poFix.length === 0) continue;
    issues.push({
      prId: pr.id,
      label: pr.quotation?.quoteNumber ?? `${requisitionDeptLabel(pr.dept)} requisition`,
      href: `/purchasing?req=${pr.id}`,
      status: pr.status,
      poNumber: po?.poNumber ?? null,
      fixes: req,
      poFixes: poFix,
    });
  }
  return { checked: prs.length, issues };
}
