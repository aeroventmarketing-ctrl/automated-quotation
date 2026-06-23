"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveGeofenceSetting } from "../actions";
import type { GeofenceConfig } from "@/lib/geofence";

export function LocationManager({ initial }: { initial: GeofenceConfig }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [label, setLabel] = useState(initial.label);
  const [lat, setLat] = useState(initial.latitude != null ? String(initial.latitude) : "");
  const [lng, setLng] = useState(initial.longitude != null ? String(initial.longitude) : "");
  const [radius, setRadius] = useState(String(initial.radiusMeters));
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function useCurrentLocation() {
    setError(null);
    setMsg(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device/browser can't provide a location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
        setMsg(`Captured current location (±${Math.round(pos.coords.accuracy)} m accuracy).`);
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — allow location to capture it."
            : "Couldn't get the current location.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const latitude = lat.trim() ? Number(lat) : null;
      const longitude = lng.trim() ? Number(lng) : null;
      const radiusMeters = Number(radius);
      if (Number.isNaN(radiusMeters) || radiusMeters < 10) throw new Error("Radius must be at least 10 m.");
      if (enabled && (latitude == null || longitude == null))
        throw new Error("Set the allowed location before enabling.");
      await saveGeofenceSetting({ enabled, latitude, longitude, radiusMeters, label });
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Location access (geofence)</CardTitle>
        <p className="text-sm text-muted-foreground">
          When enabled, non-admin users can only open the app within the radius below (checked via
          the device&apos;s location). Admins are always allowed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Restrict access to the allowed location
        </label>

        <div className="space-y-1">
          <Label>Location name (optional)</Label>
          <Input className="max-w-md" value={label} placeholder="e.g. Head Office"
            onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Latitude</Label>
            <Input className="w-40" type="number" step="any" value={lat} placeholder="14.5995"
              onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Longitude</Label>
            <Input className="w-40" type="number" step="any" value={lng} placeholder="120.9842"
              onChange={(e) => setLng(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Radius (m)</Label>
            <Input className="w-28" type="number" step="any" value={radius}
              onChange={(e) => setRadius(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating}>
            {locating ? "Locating…" : "Use my current location"}
          </Button>
        </div>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>
        )}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          <span className="text-xs text-muted-foreground">
            Tip: stand at the location and click “Use my current location”, then set a radius (e.g. 150 m).
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
