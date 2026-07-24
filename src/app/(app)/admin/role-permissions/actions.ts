"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { setRolePermissionsForRole } from "@/lib/role-permissions";

/** Save one role's capability toggles. Admin only. */
export async function saveRolePermissions(role: string, caps: Record<string, boolean>): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can manage role permissions.");
  await setRolePermissionsForRole(role, caps);
  revalidatePath("/admin/role-permissions");
  // Client-visibility masking depends on restrict_client_data, so refresh views.
  for (const p of ["/orders", "/dashboard", "/quotations"]) revalidatePath(p);
}
