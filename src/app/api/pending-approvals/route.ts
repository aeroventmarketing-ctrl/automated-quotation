import { getCurrentUser } from "@/lib/auth";
import { pendingApprovalsForUser } from "@/lib/pending-approvals";
import { getNotificationsEnabled } from "@/lib/notification-settings";

export const dynamic = "force-dynamic";

/** GET the orders currently awaiting the signed-in user's approval. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ orders: [] }, { status: 200 });
  try {
    // Admin can switch the approver alarm off globally.
    if (!(await getNotificationsEnabled())) return Response.json({ orders: [] });
    const orders = await pendingApprovalsForUser({ id: user.id, role: user.role });
    return Response.json({ orders });
  } catch {
    return Response.json({ orders: [] }, { status: 200 });
  }
}
