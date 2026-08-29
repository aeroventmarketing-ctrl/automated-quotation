import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { MobileNav } from "@/components/mobile-nav";
import { GeofenceGate } from "@/components/geofence-gate";
import { ApproverAlarm } from "@/components/approver-alarm";
import { CalendarReminders } from "@/components/calendar-reminders";
import { LiveClock } from "@/components/live-clock";
import { getGeofence } from "@/lib/geofence";
import { getDisabledRoles, isRoleEnabled } from "@/lib/role-access";
import { getWorkflowRoles, userHasWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { getSalesPersonnelIds } from "@/lib/sales-personnel";
import { getDashboardAlerts } from "@/lib/dashboard-alerts";
import { getInboundQueue } from "@/lib/inbound-rfq";
import { getInquiryAssignments } from "@/lib/inquiry-notifications";
import { getCatalogueApprovalCounts } from "@/lib/catalogue-approvals";
import { getAlertGoLive, alertsSuppressedNow } from "@/lib/alert-golive";
import { AlertSuppressionProvider } from "@/components/alert-golive-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    // We only reach the layout once the middleware has verified a Supabase
    // session, so a null app user here means an orphaned session (signed in to
    // Supabase Auth but no matching app User row by email). Redirecting to
    // /login would loop with the middleware (which sends authed users to
    // /dashboard), so clear the session via the signout route instead.
    redirect("/auth/signout");
  }

  // Role access: an admin can disable whole roles from using AeroERP. A disabled
  // role's users stay signed in but are blocked from every feature and setting.
  // Admins are never disabled (enforced in isRoleEnabled) so no one is locked out.
  const disabledRoles = await getDisabledRoles();
  if (!isRoleEnabled(user.role, disabledRoles)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aerovent-logo.jpg" alt="Aerovent Fans and Blowers Manufacturing" className="mx-auto h-10 w-auto" />
          <div>
            <h1 className="text-lg font-bold">Access temporarily disabled</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              An administrator has turned off AeroERP access for your role. Please contact your administrator
              if you believe this is a mistake.
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  // The user's workflow roles — drive the "My Dashboard" tab and per-role tab
  // show/hide in the nav.
  const wfAssignments = await getWorkflowRoles();
  const workflowRoles = WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(wfAssignments, user.id, k as WorkflowRoleKey));
  // "Credit as salesperson" (sales personnel) — gives an Engineer the Counter
  // Sales tab. SALES-role users are salespeople implicitly.
  const salesPersonnel = user.role === "SALES" || (await getSalesPersonnelIds()).includes(user.id);

  // Location access: when enabled, non-admins are confined to the geofence(s).
  const geofence = await getGeofence();
  const gated = geofence.enabled && !isAdmin(user) && geofence.locations.length > 0;

  // Alerts go-live gate: before the launch moment, every alert surface stays
  // silent. This flag blanks the presentational surfaces (inline "awaiting
  // approval" badges) via context; the timestamped surfaces gate themselves.
  const alertsSuppressed = alertsSuppressedNow(await getAlertGoLive());

  // For admins, flash a dashboard's nav item when it has new activity.
  const dashboardAlerts: Record<string, boolean> = {};
  if (isAdmin(user)) {
    const a = await getDashboardAlerts().catch(() => null);
    if (a) {
      dashboardAlerts["/my-dashboard"] = a.production;
      dashboardAlerts["/management"] = a.management;
      dashboardAlerts["/dashboard"] = a.sales;
    }
  }

  // A blinking count on "Inbound RFQs" for the roles that handle them, so a
  // client-submitted RFQ waiting to be reviewed can't be missed.
  const navCounts: Record<string, number> = {};
  if (user.role === "ADMIN" || user.role === "SALES" || user.role === "ENGINEER") {
    const pending = (await getInboundQueue().catch(() => [])).filter((i) => i.status === "pending").length;
    if (pending > 0) navCounts["/inbound-rfq"] = pending;
  }
  // New RFQ inquiries assigned to this salesperson — a blinking count on Inquiries.
  const assigned = (await getInquiryAssignments(user.id).catch(() => [])).length;
  if (assigned > 0) navCounts["/inquiries"] = assigned;
  // Catalogue changes waiting to be confirmed — a blinking count on Inventory and
  // Products for the Purchaser, Warehouse, Payment Approver and admins. Both
  // queues already show inside their own page; this is what reaches someone who
  // is somewhere else.
  const catalogue = await getCatalogueApprovalCounts(user, wfAssignments);
  if (catalogue.inventory > 0) navCounts["/inventory"] = catalogue.inventory;
  if (catalogue.products > 0) navCounts["/products"] = catalogue.products;

  const layout = (
    <div className="flex min-h-screen flex-col">
      {/* Live clock — pinned to the very top, persists on every page. */}
      <LiveClock />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 self-start border-r bg-background md:sticky md:top-11 md:block md:h-[calc(100vh-2.75rem)] md:overflow-y-auto print:!hidden">
          <AppNav role={user.role} name={user.name} workflowRoles={workflowRoles} salesPersonnel={salesPersonnel} dashboardAlerts={dashboardAlerts} navCounts={navCounts} />
        </aside>
        {/* overflow-x-clip (not -hidden) prevents horizontal overflow WITHOUT
            making <main> a scroll container — otherwise the mobile bar's sticky
            top-11 reparents to <main> and double-counts the clock height, leaving
            an empty band above the logo on mobile. */}
        <main className="min-w-0 flex-1 overflow-x-clip">
          {/* Mobile top bar */}
          <div className="sticky top-11 z-30 flex items-center justify-between border-b bg-background px-4 py-3 md:hidden print:!hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/aerovent-logo.jpg"
              alt="Aerovent Fans and Blowers Manufacturing"
              className="h-7 w-auto"
            />
            <MobileNav role={user.role} name={user.name} workflowRoles={workflowRoles} salesPersonnel={salesPersonnel} dashboardAlerts={dashboardAlerts} navCounts={navCounts} />
          </div>
          <div className="mx-auto max-w-6xl p-4 md:p-8 print:max-w-none print:p-0">{children}</div>
        </main>
      </div>
      <ApproverAlarm />
      <CalendarReminders />
    </div>
  );

  const content = gated ? <GeofenceGate locations={geofence.locations}>{layout}</GeofenceGate> : layout;
  return <AlertSuppressionProvider suppressed={alertsSuppressed}>{content}</AlertSuppressionProvider>;
}
