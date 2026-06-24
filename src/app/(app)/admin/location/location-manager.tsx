"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus } from "lucide-react";
import { saveGeofenceSetting } from "../actions";
import type { GeofenceConfig } from "@/lib/geofence";

interface Row {
  label: string;
  lat: string;
  lng: string;
  radius: string;
}

const blankRow = (): Row => ({ label: "", lat: "", lng: "", radius: "150" });

export function LocationManager({ initial }: { initial: GeofenceConfig }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [rows, setRows] = useState<Row[]>(
    initial.locations.length
      ? initial.locations.map((l) => ({
          label: l.label,
          lat: String(l.latitude),
          lng: String(l.longitude),
          radius: String(l.radiusMeters),
        }))
      : [blankRow()],
  );
  const [busy, setBusy] = useState(false);
  const [locatingIdx, setLocatingIdx] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  function captureLocation(i: number) {
    setError(null);
    setMsg(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device/browser can't provide a location.");
      return;
    }
    setLocatingIdx(i);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRow(i, { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
        setLocatingIdx(null);
        setMsg(`Captured location for #${i + 1} (±${Math.round(pos.coords.accuracy)} m accuracy).`);
      },
      (err) => {
        setLocatingIdx(null);
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
      const locations = [];
      for (const [i, r] of rows.entries()) {
        const hasAny = r.label.trim() || r.lat.trim() || r.lng.trim();
        const latitude = Number(r.lat);
        const longitude = Number(r.lng);
        const radiusMeters = Number(r.radius);
        if (!r.lat.trim() && !r.lng.trim() && !hasAny) continue; // skip fully-blank row
        if (Number.isNaN(latitude) || Number.isNaN(longitude))
          throw new Error(`Location #${i + 1}: enter a valid latitude & longitude.`);
        if (Number.isNaN(radiusMeters) || radiusMeters < 10)
          throw new Error(`Location #${i + 1}: radius must be at least 10 m.`);
        locations.push({ label: r.label.trim(), latitude, longitude, radiusMeters });
      }
      if (enabled && locations.length === 0)
        throw new Error("Add at least one location before enabling.");
      await saveGeofenceSetting({ enabled, locations });
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
          When enabled, non-admin users can only open the app within the radius of one of the
          locations below (checked via the device&apos;s location). Admins are always allowed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Restrict access to the allowed locations
        </label>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Location #{i + 1}</span>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                  onClick={() => removeRow(i)} disabled={rows.length === 1}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              </div>
              <div className="space-y-1">
                <Label>Location name (optional)</Label>
                <Input className="max-w-md" value={r.label} placeholder="e.g. Head Office"
                  onChange={(e) => setRow(i, { label: e.target.value })} />
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label>Latitude</Label>
                  <Input className="w-40" type="number" step="any" value={r.lat} placeholder="14.5995"
                    onChange={(e) => setRow(i, { lat: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Longitude</Label>
                  <Input className="w-40" type="number" step="any" value={r.lng} placeholder="120.9842"
                    onChange={(e) => setRow(i, { lng: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Radius (m)</Label>
                  <Input className="w-28" type="number" step="any" value={r.radius}
                    onChange={(e) => setRow(i, { radius: e.target.value })} />
                </div>
                <Button type="button" variant="outline" onClick={() => captureLocation(i)}
                  disabled={locatingIdx === i}>
                  {locatingIdx === i ? "Locating…" : "Use my current location"}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Add location
        </Button>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>
        )}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          <span className="text-xs text-muted-foreground">
            Tip: stand at each site and click “Use my current location”, then set a radius (e.g. 150 m).
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
