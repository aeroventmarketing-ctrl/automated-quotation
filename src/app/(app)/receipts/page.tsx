import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { canGenerateReceipts } from "@/lib/receipts-access";
import { manilaYMD } from "@/lib/department-pnl";
import { receiptDate } from "@/lib/bir-receipts";
import { Card, CardContent } from "@/components/ui/card";
import { ReceiptForm } from "./receipt-form";

export const dynamic = "force-dynamic";

/**
 * Receipt Generation — Accounting prints the BIR receipts (Sales Invoice,
 * Delivery Receipt, Collection Receipt) from their own template, filled from the
 * form below. The owner: *"Receipt generation tab will enable the Accounting role
 * to print receipts … Show this tab to payment approver and admin role."*
 */
export default async function ReceiptsPage() {
  const [viewer, roles] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  if (!canGenerateReceipts(viewer, roles)) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Receipt Generation is for Accounting, the Payment Approver and admins.
        </CardContent>
      </Card>
    );
  }
  // Orders to fill from — anything with a client PO, newest first. A narrow read:
  // the number and the client, nothing from the classification blob.
  const orders = await prisma.quotation.findMany({
    where: { classification: { path: ["sale", "po"], not: Prisma.DbNull } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, quoteNumber: true, inquiry: { select: { customer: { select: { company: true } } } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Receipt Generation</h1>
        <p className="text-sm text-muted-foreground">
          Fill the BIR receipts — Sales Invoice, Delivery Receipt and Collection Receipt — and download them in
          Accounting&apos;s own template. Print each receipt from its sheet (SI, DR, CR) onto the booklet; the
          template&apos;s row heights and column widths are exactly as uploaded.
        </p>
      </div>
      <ReceiptForm
        today={receiptDate(manilaYMD(new Date().toISOString()))}
        orders={orders.map((o) => ({ id: o.id, label: `${o.quoteNumber} · ${o.inquiry?.customer?.company ?? "—"}` }))}
      />
    </div>
  );
}
