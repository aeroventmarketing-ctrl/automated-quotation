import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { GeofenceGate } from "@/components/geofence-gate";
import { getGeofence } from "@/lib/geofence";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    // Authenticated in Supabase but no matching app User row, or not signed in.
    redirect("/login");
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
          <span className="font-bold">AeroQuote</span>
          <form action="/auth/signout" method="post">
            <button className="text-sm text-muted-foreground">Sign out</button>
          </form>
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
