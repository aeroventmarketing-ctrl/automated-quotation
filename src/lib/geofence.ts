import { prisma } from "./db";

/**
 * Location access control (geofence). When enabled, non-admin users may only
 * use the app within `radiusMeters` of one of the configured locations; admins
 * are always allowed. The check runs in the browser via the Geolocation API.
 */
export const GEOFENCE_KEY = "geofence";

export interface GeofenceLocation {
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface GeofenceConfig {
  enabled: boolean;
  locations: GeofenceLocation[];
}

export const DEFAULT_GEOFENCE: GeofenceConfig = { enabled: false, locations: [] };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function normalizeLocation(v: Record<string, unknown>): GeofenceLocation | null {
  if (!isNum(v.latitude) || !isNum(v.longitude)) return null;
  return {
    label: typeof v.label === "string" ? v.label : "",
    latitude: v.latitude,
    longitude: v.longitude,
    radiusMeters: isNum(v.radiusMeters) ? v.radiusMeters : 200,
  };
}

/** Read the geofence config. Accepts the legacy single-location shape and fails
 *  open (disabled) if the table doesn't exist yet. */
export async function getGeofence(): Promise<GeofenceConfig> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: GEOFENCE_KEY } });
    if (!row) return DEFAULT_GEOFENCE;
    const v = row.value as Record<string, unknown>;
    const enabled = v.enabled === true;
    if (Array.isArray(v.locations)) {
      const locations = (v.locations as Record<string, unknown>[])
        .map(normalizeLocation)
        .filter((l): l is GeofenceLocation => l != null);
      return { enabled, locations };
    }
    // Legacy single-location shape.
    const legacy = normalizeLocation(v);
    return { enabled, locations: legacy ? [legacy] : [] };
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
