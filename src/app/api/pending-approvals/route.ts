import { getCurrentUser } from "@/lib/auth";
import { pendingApprovalsForUser } from "@/lib/pending-approvals";

export const dynamic = "force-dynamic";

/** GET the orders currently awaiting the signed-in user's approval. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ orders: [] }, { status: 200 });
  try {
    const orders = await pendingApprovalsForUser({ id: user.id, role: user.role });
    return Response.json({ orders });
  } catch {
    return Response.json({ orders: [] }, { status: 200 });
  }
}
