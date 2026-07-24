import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { MobileNav } from "@/components/mobile-nav";
import { GeofenceGate } from "@/components/geofence-gate";
import { ApproverAlarm } from "@/components/approver-alarm";
import { CalendarReminders } from "@/components/calendar-reminders";
import { getGeofence } from "@/lib/geofence";
import { getDisabledRoles, isRoleEnabled } from "@/lib/role-access";

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

  // Location access: when enabled, non-admins are confined to the geofence(s).
  const geofence = await getGeofence();
  const gated = geofence.enabled && !isAdmin(user) && geofence.locations.length > 0;

  const layout = (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 self-start border-r bg-background md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto print:!hidden">
        <AppNav role={user.role} name={user.name} />
      </aside>
      <main className="flex-1 overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b bg-background px-4 py-3 md:hidden print:!hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/aerovent-logo.jpg"
            alt="Aerovent Fans and Blowers Manufacturing"
            className="h-7 w-auto"
          />
          <MobileNav role={user.role} name={user.name} />
        </div>
        <div className="mx-auto max-w-6xl p-4 md:p-8 print:max-w-none print:p-0">{children}</div>
      </main>
      <ApproverAlarm />
      <CalendarReminders />
    </div>
  );

  if (gated) {
    return <GeofenceGate locations={geofence.locations}>{layout}</GeofenceGate>;
  }
  return layout;
}
