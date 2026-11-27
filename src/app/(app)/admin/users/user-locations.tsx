"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveUserGeofence } from "../actions";
import type { GeofenceLocation, UserGeofences } from "@/lib/geofence";

const DEFAULT_RADIUS = "300";

interface Row {
  label: string;
  lat: string;
  lng: string;
  radius: string;
}
const blank = (): Row => ({ label: "", lat: "", lng: "", radius: DEFAULT_RADIUS });
const toRows = (locs: GeofenceLocation[] | undefined): Row[] =>
  locs && locs.length
    ? locs.map((l) => ({ label: l.label, lat: String(l.latitude), lng: String(l.longitude), radius: String(l.radiusMeters) }))
    : [blank()];

/**
 * Per-user allowed locations (lib/geofence). The owner: *"add a geolocation in
 * each user so I can limit in a specific location the usage of the app. Once no
 * coordinate is set user can use it anywhere, once coordinate is set user can
 * use it in the specific location."*
 */
export function UserLocationsCard({
  users,
  initial,
  companyOn,
}: {
  users: { id: string; name: string; email: string; role: string }[];
  initial: UserGeofences;
  /** The company-wide geofence (Admin → Location) is on — what "no locations" falls back to. */
  companyOn: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const anywhere = companyOn ? "Company locations (Admin → Location)" : "Anywhere";
  const open = (id: string) => {
    setEditing(id);
    setRows(toRows(initial[id]));
    setErr(null);
    setMsg(null);
  };
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function capture(i: number) {
    setErr(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErr("This device/browser can't provide a location.");
      return;
    }
    setLocating(i);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRow(i, { lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
        setLocating(null);
        setMsg(`Captured (±${Math.round(pos.coords.accuracy)} m accuracy).`);
      },
      (e) => {
        setLocating(null);
        setErr(e.code === e.PERMISSION_DENIED ? "Location permission denied — allow location to capture it." : "Couldn't get the current location.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function save(userId: string, clear = false) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const locations: GeofenceLocation[] = [];
      if (!clear) {
        for (const [i, r] of rows.entries()) {
          if (!r.label.trim() && !r.lat.trim() && !r.lng.trim()) continue;
          const latitude = Number(r.lat);
          const longitude = Number(r.lng);
          const radiusMeters = Number(r.radius);
          if (!r.lat.trim() || !r.lng.trim() || Number.isNaN(latitude) || Number.isNaN(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            throw new Error(`Location #${i + 1}: enter a valid latitude and longitude (or press “Use my current location”).`);
          }
          if (Number.isNaN(radiusMeters) || radiusMeters < 10) throw new Error(`Location #${i + 1}: the radius must be at least 10 m.`);
          locations.push({ label: r.label.trim(), latitude, longitude, radiusMeters });
        }
      }
      await saveUserGeofence(userId, locations);
      setMsg(locations.length ? "Saved — this user can now use the app only at these locations." : `Saved — no location set: ${anywhere.toLowerCase()}.`);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...users].sort((a, b) => Number(a.role === "ADMIN") - Number(b.role === "ADMIN") || a.name.localeCompare(b.name));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-muted-foreground" /> Allowed locations</CardTitle>
        <p className="text-xs text-muted-foreground">
          Limit where a user can use the app. With no location set the user can use it {companyOn ? "within the company locations (Admin → Location)" : "anywhere"}; with
          one or more set, only within their radius — anywhere else (or with location turned off) the whole app is blocked. Admins can always use it anywhere.
          Checked with the device&apos;s location; stand at the site and press “Use my current location” to capture it.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <Table>
          <TableHeader>
            <TableRow><TableHead>User</TableHead><TableHead>Can use the app</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((u) => {
              const locs = initial[u.id] ?? [];
              const admin = u.role === "ADMIN";
              return (
                <TableRow key={u.id} className="align-top">
                  <TableCell>
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {admin ? (
                      <span className="text-muted-foreground">Anywhere (admin)</span>
                    ) : locs.length ? (
                      <ul className="space-y-0.5">
                        {locs.map((l, i) => (
                          <li key={i}>
                            <MapPin className="mr-1 inline h-3 w-3 text-primary" />
                            {l.label || `Location ${i + 1}`} <span className="text-xs text-muted-foreground">· {l.latitude.toFixed(5)}, {l.longitude.toFixed(5)} · {l.radiusMeters} m</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">{anywhere}</span>
                    )}
                    {editing === u.id && (
                      <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                        {rows.map((r, i) => (
                          <div key={i} className="flex flex-wrap items-end gap-2 border-b pb-2 last:border-0 last:pb-0">
                            <label className="space-y-1"><span className="block text-[11px] text-muted-foreground">Name</span>
                              <Input className="h-8 w-36" value={r.label} placeholder="e.g. Plant" onChange={(e) => setRow(i, { label: e.target.value })} /></label>
                            <label className="space-y-1"><span className="block text-[11px] text-muted-foreground">Latitude</span>
                              <Input className="h-8 w-32" type="number" step="any" value={r.lat} placeholder="14.5995" onChange={(e) => setRow(i, { lat: e.target.value })} /></label>
                            <label className="space-y-1"><span className="block text-[11px] text-muted-foreground">Longitude</span>
                              <Input className="h-8 w-32" type="number" step="any" value={r.lng} placeholder="120.9842" onChange={(e) => setRow(i, { lng: e.target.value })} /></label>
                            <label className="space-y-1"><span className="block text-[11px] text-muted-foreground">Radius (m)</span>
                              <Input className="h-8 w-24" type="number" step="any" value={r.radius} onChange={(e) => setRow(i, { radius: e.target.value })} /></label>
                            <Button type="button" size="sm" variant="outline" className="h-8" disabled={locating === i} onClick={() => capture(i)}>
                              {locating === i ? "Locating…" : "Use my current location"}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove location">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRows((rs) => [...rs, blank()])}>
                          <Plus className="h-3.5 w-3.5" /> Add location
                        </Button>
                        {err && <p className="text-xs text-destructive">{err}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" className="h-8" disabled={busy} onClick={() => save(u.id)}>{busy ? "Saving…" : "Save"}</Button>
                          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {!admin && editing !== u.id && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => open(u.id)}>
                          {locs.length ? "Edit locations" : "Set location"}
                        </Button>
                        {locs.length > 0 && (
                          <Button size="sm" variant="ghost" className="ml-1 h-7 text-xs text-destructive" disabled={busy}
                            onClick={() => window.confirm(`Remove ${u.name}'s locations? They can then use the app ${anywhere.toLowerCase()}.`) && save(u.id, true)}>
                            Remove
                          </Button>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
