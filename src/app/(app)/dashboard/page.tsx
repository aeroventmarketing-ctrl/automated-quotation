import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { DASHBOARD_CONSOLIDATED_ROLES } from "@/lib/dashboard-consolidation";
import { SalesDashboardBody } from "./sales-dashboard-body";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [user, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  // Roles whose dashboard is consolidated into My Dashboard land there instead —
  // one dashboard to monitor. Admins always keep the Sales Dashboard here.
  if (
    user != null &&
    !isAdmin(user) &&
    DASHBOARD_CONSOLIDATED_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r as WorkflowRoleKey))
  ) {
    redirect("/my-dashboard");
  }
  return <SalesDashboardBody />;
}
