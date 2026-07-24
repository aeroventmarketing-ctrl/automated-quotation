import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { isClientRestricted } from "@/lib/client-visibility";
import { listActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

/**
 * GET the recent system activity feed for the dashboard notification bell.
 * Client-restricted shop-floor roles get nothing (activity summaries can name
 * clients and amounts), matching the client-visibility masking policy.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ activity: [] });
  try {
    const assignments = await getWorkflowRoles();
    if (await isClientRestricted(user, assignments)) return Response.json({ activity: [] });
    const activity = await listActivity(50);
    return Response.json({ activity });
  } catch {
    return Response.json({ activity: [] });
  }
}
