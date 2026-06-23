import { prisma } from "./db";

/**
 * Location access control (geofence). When enabled, non-admin users may only
 * use the app within `radiusMeters` of (latitude, longitude); admins are always
 * allowed. The check runs in the browser via the Geolocation API.
 */
export const GEOFENCE_KEY = "geofence";

export interface GeofenceConfig {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  label: string;
}

export const DEFAULT_GEOFENCE: GeofenceConfig = {
  enabled: false,
  latitude: null,
  longitude: null,
  radiusMeters: 200,
  label: "",
};

/** Read the geofence config. Fails open (disabled) if the table doesn't exist yet. */
export async function getGeofence(): Promise<GeofenceConfig> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: GEOFENCE_KEY } });
    if (!row) return DEFAULT_GEOFENCE;
    return { ...DEFAULT_GEOFENCE, ...(row.value as Partial<GeofenceConfig>) };
  } catch {
    return DEFAULT_GEOFENCE;
  }
}

/** Great-circle distance between two lat/lng points, in metres (haversine). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
