"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, LoaderCircle } from "lucide-react";

type Status = "checking" | "ok" | "denied" | "outside" | "unavailable";

/** Great-circle distance in metres (haversine) — inlined so this stays client-only. */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Blocks the app for non-admin users outside the allowed location. The server
 * only mounts this when the geofence is enabled and the user isn't an admin.
 */
export function GeofenceGate({
  latitude,
  longitude,
  radiusMeters,
  label,
  children,
}: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  label: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [distance, setDistance] = useState<number | null>(null);

  const check = useCallback(() => {
    setStatus("checking");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const d = distanceMeters(pos.coords.latitude, pos.coords.longitude, latitude, longitude);
        setDistance(d);
        setStatus(d <= radiusMeters ? "ok" : "outside");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, [latitude, longitude, radiusMeters]);

  useEffect(() => {
    check();
  }, [check]);

  if (status === "ok") return <>{children}</>;

  const where = label ? ` (${label})` : "";
  const message =
    status === "checking"
      ? "Checking your location…"
      : status === "denied"
        ? "Location access is required to use this app. Please allow location in your browser and retry."
        : status === "unavailable"
          ? "Your location couldn't be determined. Enable location services and retry."
          : `This app can only be used at the authorized location${where}. You appear to be ${
              distance != null ? `about ${Math.round(distance)} m` : "too far"
            } away.`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-muted p-4">
        {status === "checking" ? (
          <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : (
          <MapPin className="h-8 w-8 text-destructive" />
        )}
      </div>
      <h1 className="text-xl font-bold">
        {status === "checking" ? "Verifying location" : "Location restricted"}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {status !== "checking" && (
        <div className="flex items-center gap-3">
          <button
            onClick={check}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retry
          </button>
          <form action="/auth/signout" method="post">
            <button className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
