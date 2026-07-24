import { prisma } from "@/lib/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { buildCashRequestRow, type CashRequestLike } from "@/lib/cash-request-row";
import type { CashActor } from "@/lib/cash-request";
import { CashRequestForm } from "./cash-request-form";
import { CashRequestList } from "./cash-request-list";

export const dynamic = "force-dynamic";

export default async function CashRequestsPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  if (!viewer) return null;
  const admin = isAdmin(viewer);
  const has = (r: WorkflowRoleKey) => userHasWorkflowRole(assignments, viewer.id, r);
  // Finance roles (and admins) monitor everyone's requests; everyone else sees
  // only the requests they raised themselves.
  const finance = admin || has("accounting") || has("payment_approver");

  const userName = new Map<string, string>();
  const namesForActor = (actor: CashActor): string[] => {
    if (actor === "requestor") return [];
    return usersWithWorkflowRole(assignments, actor).map((uid) => userName.get(uid)).filter((n): n is string => !!n);
  };

  let rows: ReturnType<typeof buildCashRequestRow>[] = [];
  let tableMissing = false;
  try {
    const [requests, allUsers] = await Promise.all([
      prisma.cashRequest.findMany({
        where: finance ? {} : { requestedById: viewer.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.user.findMany({ select: { id: true, name: true } }),
    ]);
    allUsers.forEach((u) => userName.set(u.id, u.name));
    rows = requests.map((r) =>
      buildCashRequestRow(r as CashRequestLike, {
        admin,
        viewerId: viewer.id,
        hasRole: (role) => has(role),
        namesForActor,
      }),
    );
  } catch {
    tableMissing = true;
  }

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-bold">Cash requests</h1>
        <p className="text-sm text-muted-foreground">
          Request cash from Accounting. Accounting prepares the voucher, the Approver approves &amp; releases the cash, Accounting hands it to you, then you liquidate it with receipts.
        </p>
      </div>

      <CashRequestForm depts={PRODUCTION_DEPTS.map((d) => ({ key: d.key, label: d.label }))} />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {finance ? "All cash requests" : "My cash requests"}
        </h2>
        {tableMissing ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Cash requests aren&apos;t set up yet — run the database migration.</CardContent></Card>
        ) : (
          <Card><CardContent className="pt-6"><CashRequestList rows={rows} /></CardContent></Card>
        )}
      </div>
    </div>
  );
}
