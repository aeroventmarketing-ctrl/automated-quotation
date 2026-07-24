"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UserRow { id: string; name: string; email: string; role: string }

export function DocumentAccessManager({
  users,
  initialGranted,
  persistedGranted,
  restrictedIds,
  recommendedIds,
  onSave,
}: {
  users: UserRow[];
  initialGranted: string[];
  /** What's actually saved (baseline for the dirty check). */
  persistedGranted: string[];
  /** Users who must NOT see client documents (restricted shop-floor roles). */
  restrictedIds: string[];
  /** Users recommended for access by the client-visibility policy. */
  recommendedIds: string[];
  onSave: (input: { ids: string[] }) => Promise<string[]>;
}) {
  const [granted, setGranted] = useState<Set<string>>(new Set(initialGranted));
  const [baseline, setBaseline] = useState<Set<string>>(new Set(persistedGranted));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const restricted = new Set(restrictedIds);
  const dirty = granted.size !== baseline.size || [...granted].some((id) => !baseline.has(id));

  const filtered = q.trim()
    ? users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q.trim().toLowerCase()))
    : users;

  function toggle(id: string) {
    setGranted((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function selectRecommended() {
    setGranted(new Set(recommendedIds));
  }
  function clearAll() {
    setGranted(new Set());
  }
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const saved = await onSave({ ids: [...granted] });
      setGranted(new Set(saved));
      setBaseline(new Set(saved));
      setMsg("Saved.");
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  // How many restricted users are currently granted — surfaced as a caution.
  const grantedRestricted = [...granted].filter((id) => restricted.has(id)).length;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input className="h-8 w-64" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex items-center gap-2">
            {msg && <span className="text-xs text-emerald-600">{msg}</span>}
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={selectRecommended}>Select recommended</Button>
            <Button size="sm" variant="outline" className="h-8" disabled={busy || granted.size === 0} onClick={clearAll}>Clear all</Button>
            <Button size="sm" className="h-8" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Recommended</span> = everyone except the client-restricted shop-floor roles
          (they must not see client identity or purchase amounts). Adjust as needed, then Save.
          {grantedRestricted > 0 && (
            <span className="ml-1 font-medium text-amber-600">
              {grantedRestricted} restricted user{grantedRestricted === 1 ? "" : "s"} currently granted.
            </span>
          )}
        </p>
        <div className="divide-y rounded-md border">
          {filtered.map((u) => {
            const isRestricted = restricted.has(u.id);
            const on = granted.has(u.id);
            return (
              <label key={u.id} className="flex cursor-pointer items-center gap-3 p-2.5 text-sm hover:bg-accent/40">
                <input type="checkbox" className="accent-[#ED1C24]" checked={on} onChange={() => toggle(u.id)} />
                <span className="flex-1">
                  <span className="font-medium">{u.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{u.email} · {u.role}</span>
                  {isRestricted && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      Restricted role
                    </span>
                  )}
                </span>
                {on && isRestricted ? (
                  <span className="text-xs font-medium text-amber-600">Can view (restricted)</span>
                ) : on ? (
                  <span className="text-xs font-medium text-emerald-600">Can view</span>
                ) : null}
              </label>
            );
          })}
          {filtered.length === 0 && <p className="p-3 text-center text-sm text-muted-foreground">No users match.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Admins and each quote&apos;s own preparer can always view documents — you don&apos;t need to grant them here.</p>
      </CardContent>
    </Card>
  );
}
