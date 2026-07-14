import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { round2 } from "@/lib/quote";
import { MarkPaid } from "./mark-paid";

export const dynamic = "force-dynamic";

/** Payout date: 15 days after the sales month ends (≈ the 15th of the next month). */
function payoutDate(salesMonth: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(salesMonth);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 0 : month; // 0-indexed month of the *next* month
  return new Date(nextYear, nextMonth, 15);
}

const monthLabel = (salesMonth: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(salesMonth);
  if (!m) return salesMonth;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
};

export default async function CommissionsPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const canManage = isAdmin(viewer) || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "accounting"));
  const canView = canManage || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "payment_approver"));

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Commissions</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to sales commissions. Ask an admin for the Accounting role.</p>
      </div>
    );
  }

  let rows: Awaited<ReturnType<typeof loadRows>> = [];
  let tableMissing = false;
  try {
    rows = await loadRows();
  } catch {
    tableMissing = true;
  }

  const total = round2(rows.reduce((a, r) => a + r.amount, 0));
  const unpaid = round2(rows.filter((r) => !r.paid).reduce((a, r) => a + r.amount, 0));
  const paidTotal = round2(total - unpaid);
  const currency = "PHP";

  const tiles = [
    { label: "Commissions", value: String(rows.length) },
    { label: "Total (1.5%)", value: formatCurrency(total, currency) },
    { label: "Unpaid", value: formatCurrency(unpaid, currency) },
    { label: "Paid", value: formatCurrency(paidTotal, currency) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Commissions</h1>
        <p className="text-sm text-muted-foreground">1.5% of order value on closed orders, per salesperson · paid 15 days after the sales month.</p>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The commissions table isn&apos;t set up yet. Run migration 0007 in Supabase, then close an order to generate commissions.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.map((t) => (
              <Card key={t.label}>
                <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">{t.label}</CardTitle></CardHeader>
                <CardContent><div className="text-xl font-bold tabular-nums">{t.value}</div></CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="pt-6">
              {rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No commissions yet. They appear when an order is closed.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sales month</TableHead>
                        <TableHead>Salesperson</TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead className="text-right">Order value</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead>Payout</TableHead>
                        <TableHead>Status</TableHead>
                        {canManage && <TableHead className="text-right">Action</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const payout = payoutDate(r.salesMonth);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap text-sm">{monthLabel(r.salesMonth)}</TableCell>
                            <TableCell className="text-sm">{r.salespersonName}</TableCell>
                            <TableCell>
                              <Link href={`/orders/${r.quotationId}`} className="text-primary hover:underline">{r.quoteNumber}</Link>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(r.orderValue, currency)}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatCurrency(r.amount, currency)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{payout ? formatDate(payout) : "—"}</TableCell>
                            <TableCell>
                              {r.paid ? (
                                <Badge variant="success">Paid{r.paidByName ? ` · ${r.paidByName}` : ""}</Badge>
                              ) : (
                                <Badge variant="secondary">Unpaid</Badge>
                              )}
                            </TableCell>
                            {canManage && (
                              <TableCell className="text-right"><MarkPaid id={r.id} paid={r.paid} /></TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

async function loadRows() {
  const list = await prisma.commission.findMany({
    orderBy: [{ salesMonth: "desc" }, { salespersonName: "asc" }],
    include: { quotation: { select: { quoteNumber: true } } },
  });
  return list.map((c) => ({
    id: c.id,
    quotationId: c.quotationId,
    quoteNumber: c.quotation.quoteNumber,
    salespersonName: c.salespersonName,
    orderValue: Number(c.orderValue),
    amount: Number(c.amount),
    salesMonth: c.salesMonth,
    paid: c.paid,
    paidByName: c.paidByName,
  }));
}
