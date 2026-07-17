import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { MobileNav } from "@/components/mobile-nav";
import { GeofenceGate } from "@/components/geofence-gate";
import { ApproverAlarm } from "@/components/approver-alarm";
import { getGeofence } from "@/lib/geofence";

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
    </div>
  );

  if (gated) {
    return <GeofenceGate locations={geofence.locations}>{layout}</GeofenceGate>;
  }
  return layout;
}
