import { prisma } from "@/lib/db";
import { getSignatureMap } from "@/lib/signature";
import { UsersManager } from "./users-manager";
import { LoginAuditCard } from "./login-audit";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const [users, signatures] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getSignatureMap(),
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
        }))}
      />
      <LoginAuditCard />
    </div>
  );
}
