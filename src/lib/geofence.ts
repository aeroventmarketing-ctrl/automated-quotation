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

// --- Per-user locations ---------------------------------------------------------
//
// The owner: *"add a geolocation in each user so I can limit in a specific
// location the usage of the app. Once no coordinate is set user can use it
// anywhere, once coordinate is set user can use it in the specific location."*
// Clarified: a radius per user (default 300 m), several locations per user, the
// whole app blocked outside them (or with location off), admins always exempt.
//
// Stored beside the company geofence, in AppSetting — no new column:
// `{ [userId]: GeofenceLocation[] }`.

export const USER_GEOFENCE_KEY = "user-geofence";
export const USER_GEOFENCE_DEFAULT_RADIUS = 300;

export type UserGeofences = Record<string, GeofenceLocation[]>;

/** Every user's own allowed locations. Fails open (none) if unreadable. */
export async function getUserGeofences(): Promise<UserGeofences> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: USER_GEOFENCE_KEY } });
    return coerceUserGeofences(row?.value);
  } catch {
    return {};
  }
}

export function coerceUserGeofences(v: unknown): UserGeofences {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: UserGeofences = {};
  for (const [id, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const locs = (list as Record<string, unknown>[])
      .map((l) => (l && typeof l === "object" ? normalizeLocation(l) : null))
      .filter((l): l is GeofenceLocation => l != null);
    if (locs.length) out[id] = locs;
  }
  return out;
}

/**
 * Where this user may use the app, or null for anywhere:
 *  - an admin — anywhere, always (nobody can be locked out of the settings);
 *  - a user with their OWN locations — only within those;
 *  - otherwise the company geofence, when it is on;
 *  - otherwise anywhere.
 */
export function gateLocationsFor(
  user: { id: string; admin: boolean },
  company: GeofenceConfig,
  perUser: UserGeofences,
): GeofenceLocation[] | null {
  if (user.admin) return null;
  const own = perUser[user.id];
  if (own && own.length > 0) return own;
  if (company.enabled && company.locations.length > 0) return company.locations;
  return null;
}
