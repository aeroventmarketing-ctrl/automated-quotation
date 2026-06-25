import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { MobileNav } from "@/components/mobile-nav";
import { GeofenceGate } from "@/components/geofence-gate";
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
      <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
        <AppNav role={user.role} name={user.name} />
      </aside>
      <main className="flex-1 overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/aerovent-logo.jpg"
            alt="Aerovent Fans and Blowers Manufacturing"
            className="h-7 w-auto"
          />
          <MobileNav role={user.role} name={user.name} />
        </div>
        <div className="mx-auto max-w-6xl p-4 md:p-8">{children}</div>
      </main>
    </div>
  );

  if (gated) {
    return <GeofenceGate locations={geofence.locations}>{layout}</GeofenceGate>;
  }
  return layout;
}
