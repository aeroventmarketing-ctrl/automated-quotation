import { prisma } from "@/lib/db";
import { getSignatureMap } from "@/lib/signature";
import { getWorkflowRoles, WORKFLOW_ROLES } from "@/lib/workflow-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setUserWorkflowRolesAction } from "../actions";
import { WorkflowRolesManager } from "../workflow-roles/workflow-roles-manager";
import { UsersManager } from "./users-manager";
import { LoginAuditCard } from "./login-audit";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const [users, signatures, assignments] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getSignatureMap(),
    getWorkflowRoles(),
  ]);
  const workflowRoleOptions = WORKFLOW_ROLES.map((r) => ({ key: r.key, label: r.label, group: r.group }));
  const byName = [...users].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <UsersManager
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          salesCode: u.salesCode ?? "",
          signature: signatures[u.id] ?? null,
          workflowRoles: assignments[u.id] ?? [],
        }))}
        workflowRoleOptions={workflowRoleOptions}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Workflow roles</CardTitle>
          <p className="text-xs text-muted-foreground">
            Assign the departmental roles that drive the workflows (Purchasing, Requisitions, Cash requests, orders). A person can hold several; changes save immediately.
          </p>
        </CardHeader>
        <CardContent>
          <WorkflowRolesManager
            users={byName.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
            roles={workflowRoleOptions}
            initial={assignments}
            onSave={setUserWorkflowRolesAction}
          />
        </CardContent>
      </Card>

      <LoginAuditCard />
    </div>
  );
}
