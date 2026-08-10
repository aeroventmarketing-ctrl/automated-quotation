/**
 * "Reconciled by hand" — purchase-order vouchers whose reconciliation figures were
 * typed in manually (tallied against the PO) rather than AI-read and verified
 * against the uploaded receipt. Read-only reporting for the Production Dashboard.
 *
 * A row qualifies when the reconciliation has recorded lines, was NOT AI-verified
 * (`aiVerified !== true`), and carries a `recordedAt` stamp — i.e. someone tallied
 * it by hand. Each row keeps who recorded it, their designation, and the date/time.
 */
import { prisma } from "@/lib/db";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { coerceReconciliation, isReconciled } from "@/lib/purchase-reconcile";
import { formatDateTime } from "@/lib/utils";

export interface ManualReconRow {
  prId: string;
  poNumber: string;
  supplier: string;
  amount: number; // voucher (PO net)
  actualSpent: number | null;
  recordedByName: string;
  recordedRole: string; // designation, e.g. "Accounting"
  recordedAtISO: string;
  recordedLabel: string; // "Name (Designation) · Aug 9, 2026, 6:27 PM"
  href: string;
}

export async function getManualReconciliations(): Promise<ManualReconRow[]> {
  const prs = await prisma.purchaseRequest
    .findMany({ select: { id: true, po: true, reconciliation: true } })
    .catch(() => []);

  const rows: ManualReconRow[] = [];
  for (const pr of prs) {
    const r = coerceReconciliation(pr.reconciliation);
    // Reconciled by hand = recorded tally, NOT AI-verified against the receipt.
    if (!isReconciled(r) || r.aiVerified === true || !r.recordedAt) continue;

    const po = coercePurchaseOrder(pr.po);
    const net = po ? poTotals(po).net : 0;
    const actual = Array.isArray(r.lines) ? r.lines.reduce((a, l) => a + (Number(l.actualAmount) || 0), 0) : null;
    const role = r.recordedRole || "";
    rows.push({
      prId: pr.id,
      poNumber: po?.poNumber || "—",
      supplier: po?.supplier?.company || "",
      amount: net,
      actualSpent: actual,
      recordedByName: r.recordedByName || "—",
      recordedRole: role,
      recordedAtISO: r.recordedAt,
      recordedLabel: `${r.recordedByName || "—"}${role ? ` (${role})` : ""} · ${formatDateTime(new Date(r.recordedAt))}`,
      href: `/purchasing/po/${pr.id}`,
    });
  }
  // Most recently recorded first.
  return rows.sort((a, b) => b.recordedAtISO.localeCompare(a.recordedAtISO));
}
