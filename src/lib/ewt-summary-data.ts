/**
 * Server side of the EWT Summary — reads the POs and the confirmed sales, and
 * the proofs of payment to BIR. See lib/ewt-summary for the rules.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { poBatchId } from "@/lib/purchase-batch";
import { coerceReconciliation } from "@/lib/purchase-reconcile";
import { getSuppliers } from "@/lib/suppliers";
import { getAccountsRegistry } from "@/lib/account";
import { saleFromClassification, isSaleConfirmed, ewtWithheld, saleDocReadsFromClassification } from "@/lib/sale";
import { payableTotal, round2, vatModeChargesOutputVat } from "@/lib/quote";
import { saleRecognitionDate, manilaYMD } from "@/lib/department-pnl";
import { slimClassificationByOrder, withSlimClassification, CONFIRMED_SALE } from "@/lib/slim-classification";
import { docNumberFor, tinFromReads, ewtFromReads } from "@/lib/sales-summary";
import {
  coerceEwtProof,
  inPeriod,
  netOfVat,
  sortEwtRows,
  supplierEwtDate,
  type EwtKind,
  type EwtPeriod,
  type EwtProof,
  type EwtRow,
} from "@/lib/ewt-summary";

const OFF_CHAIN = new Set(["REJECTED", "CANCELLED"]);

/** The proofs on file for these rows. `ready: false` until migration 0063 is applied. */
async function proofsFor(kind: EwtKind, keys: string[]): Promise<{ byKey: Map<string, EwtProof>; ready: boolean }> {
  const byKey = new Map<string, EwtProof>();
  if (keys.length === 0) return { byKey, ready: true };
  try {
    const rows = await prisma.ewtRemittance.findMany({ where: { kind, refKey: { in: keys } }, select: { refKey: true, proof: true } });
    for (const r of rows) {
      const p = coerceEwtProof(r.proof);
      if (p) byKey.set(r.refKey, p);
    }
    return { byKey, ready: true };
  } catch {
    return { byKey, ready: false };
  }
}

/**
 * Supplier EWT — 1601-EQ. One row per PO that withholds EWT (a combined PO is one
 * PO, so one row), dated by the PO date — as the 2307 is. A PO whose every request was
 * rejected or cancelled is void and left out.
 */
async function supplierRows(period: EwtPeriod): Promise<EwtRow[]> {
  const prs = await prisma.purchaseRequest.findMany({
    where: { po: { not: Prisma.DbNull } },
    select: { id: true, status: true, po: true, reconciliation: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  // Group a combined PO's members; the first in createdAt-desc order is the
  // anchor, as everywhere else on Purchasing.
  const batches = new Map<string, typeof prs>();
  for (const pr of prs) {
    const key = poBatchId(pr.po) ?? pr.id;
    (batches.get(key) ?? batches.set(key, []).get(key)!).push(pr);
  }
  const suppliers = await getSuppliers().catch(() => []);
  const dir = new Map(suppliers.map((s) => [s.company.trim().toLowerCase(), s]));

  const rows: EwtRow[] = [];
  for (const [refKey, members] of batches) {
    if (members.every((m) => OFF_CHAIN.has(m.status))) continue;
    const anchor = members[0];
    const po = coercePurchaseOrder(anchor.po);
    if (!po) continue;
    const t = poTotals(po);
    if (!(t.ewt > 0)) continue;

    const dated = supplierEwtDate({ poDate: po.date || null, createdYMD: manilaYMD(anchor.createdAt.toISOString()) });
    if (!inPeriod(dated.date, period)) continue;

    const d = dir.get(po.supplier.company.trim().toLowerCase());
    const invoiceNumber = members.map((m) => coerceReconciliation(m.reconciliation).invoiceNumber).find(Boolean) ?? "";
    rows.push({
      kind: "supplier",
      refKey,
      date: dated.date,
      dateBasis: dated.basis,
      registeredName: po.supplier.company || "—",
      address: (d?.address || po.supplier.address || "").trim(),
      tin: (d?.tin ?? "").trim(),
      siNumber: invoiceNumber,
      reference: po.poNumber,
      href: `/purchasing?req=${anchor.id}`,
      gross: t.total,
      netOfVat: netOfVat(t.total),
      ewt: t.ewt,
      pop: null,
    });
  }
  return rows;
}

/**
 * Client EWT — 1701Q. Every confirmed sale where the client withheld EWT (read off
 * the Collection Receipt, else the EWT payment lines on the order), dated by the
 * payment date, as the Sales Summary dates it.
 */
async function clientRows(period: EwtPeriod): Promise<EwtRow[]> {
  const [quotes, slim, accounts] = await Promise.all([
    prisma.quotation.findMany({
      where: CONFIRMED_SALE,
      select: {
        id: true, quoteNumber: true, total: true, discountPct: true, vatMode: true,
        inquiry: { select: { customerId: true, customer: { select: { company: true, address: true } } } },
      },
    }),
    slimClassificationByOrder(),
    getAccountsRegistry(),
  ]);
  // Confirmed and paid in the period first — then the document reads, which the
  // slim classification leaves out, for just those orders.
  const inRange = quotes
    .map((row) => withSlimClassification(row, slim))
    .map((q) => ({ q, sale: saleFromClassification(q.classification) }))
    .filter(({ sale }) => !!sale && isSaleConfirmed(sale))
    .map((x) => ({ ...x, date: saleRecognitionDate(x.sale) }))
    .filter((x): x is typeof x & { date: string } => !!x.date && inPeriod(manilaYMD(x.date), period));
  if (inRange.length === 0) return [];
  const readRows = await prisma.$queryRaw<{ id: string; reads: unknown }[]>`
    select "id", "classification"->'saleDocReads' as "reads" from "Quotation" where "id" = any(${inRange.map((x) => x.q.id)})
  `;
  const readsById = new Map(readRows.map((r) => [r.id, saleDocReadsFromClassification({ saleDocReads: r.reads })]));

  const rows: EwtRow[] = [];
  for (const { q, sale, date } of inRange) {
    const reads = readsById.get(q.id) ?? {};
    const ewt = round2(ewtFromReads(reads) ?? ewtWithheld(sale));
    if (!(ewt > 0)) continue;
    const gross = round2(payableTotal(q));
    const customerId = q.inquiry?.customerId ?? "";
    rows.push({
      kind: "client",
      refKey: q.id,
      date: manilaYMD(date),
      dateBasis: "Payment date",
      registeredName: q.inquiry?.customer?.company ?? "—",
      address: (q.inquiry?.customer?.address ?? "").trim(),
      tin: tinFromReads(reads) || (customerId && accounts[customerId]?.tin) || "",
      siNumber: docNumberFor(reads, "sales_invoice"),
      reference: q.quoteNumber,
      href: `/orders/${q.id}`,
      gross,
      netOfVat: netOfVat(gross, vatModeChargesOutputVat(q.vatMode)),
      ewt,
      pop: null,
    });
  }
  return rows;
}

export interface EwtSummaryData {
  supplier: EwtRow[];
  client: EwtRow[];
  /** Migration 0063 not applied yet — no proofs can be stored. */
  proofsMissing: boolean;
}

export async function loadEwtSummary(period: EwtPeriod, which: EwtKind | "both" = "both"): Promise<EwtSummaryData> {
  const [sup, cli] = await Promise.all([
    which === "client" ? Promise.resolve([]) : supplierRows(period),
    which === "supplier" ? Promise.resolve([]) : clientRows(period),
  ]);
  const [sp, cp] = await Promise.all([proofsFor("supplier", sup.map((r) => r.refKey)), proofsFor("client", cli.map((r) => r.refKey))]);
  const withPop = (rows: EwtRow[], m: Map<string, EwtProof>) => sortEwtRows(rows.map((r) => ({ ...r, pop: m.get(r.refKey) ?? null })));
  return { supplier: withPop(sup, sp.byKey), client: withPop(cli, cp.byKey), proofsMissing: !sp.ready || !cp.ready };
}
