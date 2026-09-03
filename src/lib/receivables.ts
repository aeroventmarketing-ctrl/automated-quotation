/**
 * Receivables — what confirmed customers still owe us.
 *
 * This exists so the Management Dashboard's **Receivables** tile and the Check
 * Monitoring cash position show the SAME number. The owner asked for exactly
 * that: *"Collectibles change to Receivables, link and show the amount from
 * Receivables in Management dashboard."*
 *
 * The dashboard computes its figure inside a loop that also builds a dozen other
 * things, so the rule — not the loop — is what lives here, and both callers use
 * it. Two screens quoting the same label at different numbers is the kind of
 * thing that quietly destroys trust in every other figure on the page.
 */
import { prisma } from "@/lib/db";
import { saleFromClassification, isSaleConfirmed, collectedTotal, type SaleRecord } from "@/lib/sale";
import { saleRecognitionDate, manilaYMD } from "@/lib/department-pnl";
import { getAlertGoLive } from "@/lib/alert-golive";
import { payableTotal, round2 } from "@/lib/quote";

/** The quotation fields the receivable rule reads. */
export interface ReceivableQuote {
  classification: unknown;
  total: unknown;
  discountPct: unknown;
  vatMode: unknown;
}

export interface OrderReceivable {
  /** What the deal is worth to us. */
  value: number;
  /** Collected so far — cash plus EWT. */
  paid: number;
  /** Still owed. Negative would mean overpaid; callers only bank the positive. */
  balance: number;
}

/**
 * Does this order count towards receivables at all?
 *
 * Confirmed sales only — deliberately NOT `inquiry.status === "WON"`, because a
 * quotation revision reopens the inquiry and would drop a confirmed, already-paid
 * order. And when the go-live gate is on, an order recognised before launch day
 * is out: it belongs to the books that came before.
 */
export function countsAsReceivable(sale: SaleRecord | null, goLiveFloorYMD: string | null): boolean {
  if (!sale || !isSaleConfirmed(sale)) return false;
  if (!goLiveFloorYMD) return true;
  const recAt = saleRecognitionDate(sale);
  return !!recAt && manilaYMD(recAt) >= goLiveFloorYMD;
}

/** Deal value, collected, and the balance between them. */
export function receivableOf(q: ReceivableQuote, sale: SaleRecord): OrderReceivable {
  const value = round2(payableTotal(q as Parameters<typeof payableTotal>[0]));
  const paid = round2(collectedTotal(sale));
  return { value, paid, balance: round2(value - paid) };
}

/** A balance small enough to be rounding, not debt. */
export const RECEIVABLE_EPSILON = 0.005;

/**
 * Total outstanding receivables — the figure on the Management Dashboard's
 * Receivables tile, computed the same way, from its own query.
 */
export async function getReceivablesOutstanding(): Promise<number> {
  const alertGate = await getAlertGoLive().catch(() => null);
  const goLiveFloorYMD = alertGate?.on ? manilaYMD(alertGate.at) : null;
  const quotes = await prisma.quotation.findMany({
    select: { classification: true, total: true, discountPct: true, vatMode: true },
  });
  let outstanding = 0;
  for (const q of quotes) {
    const sale = saleFromClassification(q.classification);
    if (!countsAsReceivable(sale, goLiveFloorYMD)) continue;
    const { balance } = receivableOf(q, sale!);
    if (balance > RECEIVABLE_EPSILON) outstanding = round2(outstanding + balance);
  }
  return outstanding;
}
