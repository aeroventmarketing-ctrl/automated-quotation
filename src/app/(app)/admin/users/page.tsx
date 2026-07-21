import { prisma } from "@/lib/db";
import { getSignatureMap } from "@/lib/signature";
import { getWorkflowRoles, WORKFLOW_ROLES } from "@/lib/workflow-roles";
import { UsersManager } from "./users-manager";
import { LoginAuditCard } from "./login-audit";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const [users, signatures, assignments] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getSignatureMap(),
    getWorkflowRoles(),
  ]);
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
        workflowRoleOptions={WORKFLOW_ROLES.map((r) => ({ key: r.key, label: r.label, group: r.group }))}
      />
      <LoginAuditCard />
    </div>
  );
}
