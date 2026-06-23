import { getGeofence } from "@/lib/geofence";
import { LocationManager } from "./location-manager";

export const dynamic = "force-dynamic";

export default async function AdminLocationPage() {
  const cfg = await getGeofence();
  return <LocationManager initial={cfg} />;
}
