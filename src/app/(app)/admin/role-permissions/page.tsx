import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { WORKFLOW_ROLES } from "@/lib/workflow-roles";
import { CAPABILITY_GROUPS, getRolePermissions, roleHasCapability } from "@/lib/role-permissions";
import { RolePermissionsManager } from "./role-permissions-manager";
import { saveRolePermissions } from "./actions";

export const dynamic = "force-dynamic";

export default async function RolePermissionsPage() {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return <div className="space-y-2"><h1 className="text-2xl font-bold">Role permissions</h1><p className="text-sm text-muted-foreground">Admins only.</p></div>;
  }
  const perms = await getRolePermissions();

  const roles = WORKFLOW_ROLES.map((r) => ({ key: r.key, label: r.label, group: r.group }));
  const values: Record<string, Record<string, boolean>> = {};
  for (const r of WORKFLOW_ROLES) {
    values[r.key] = {};
    for (const g of CAPABILITY_GROUPS) for (const c of g.items) values[r.key][c.key] = roleHasCapability(perms, r.key, c.key);
  }

  return (
    <div className="space-y-5">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Admin
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Role permissions</h1>
        <p className="text-sm text-muted-foreground">Set each role&rsquo;s restrictions and approved tasks. Pick a role, tick what applies, and save.</p>
      </div>
      <RolePermissionsManager roles={roles} groups={CAPABILITY_GROUPS} values={values} onSave={saveRolePermissions} />
    </div>
  );
}
