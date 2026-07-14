import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKFLOW_ROLES, getWorkflowRoles } from "@/lib/workflow-roles";
import { setUserWorkflowRolesAction } from "../actions";
import { WorkflowRolesManager } from "./workflow-roles-manager";

export const dynamic = "force-dynamic";

/** Admin page to assign ERP workflow roles (Accounting, Approver, Technical Head,
 *  Production heads, Warehouse, Purchaser, Logistics, Plant Manager) to users. */
export default async function WorkflowRolesPage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) redirect("/dashboard");

  const [users, assignments] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, role: true } }),
    getWorkflowRoles(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Workflow roles</h1>
        <p className="text-sm text-muted-foreground">
          Assign the departmental roles that drive order approvals. A person can hold more than one.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Assign roles per user</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowRolesManager
            users={users}
            roles={WORKFLOW_ROLES.map((r) => ({ key: r.key, label: r.label, group: r.group }))}
            initial={assignments}
            onSave={setUserWorkflowRolesAction}
          />
        </CardContent>
      </Card>
    </div>
  );
}
