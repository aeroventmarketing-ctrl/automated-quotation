"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface UserRow { id: string; name: string; email: string; role: string }

export function DocumentAccessManager({
  users,
  initialGranted,
  onSave,
}: {
  users: UserRow[];
  initialGranted: string[];
  onSave: (input: { ids: string[] }) => Promise<string[]>;
}) {
  const [granted, setGranted] = useState<Set<string>>(new Set(initialGranted));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const initial = new Set(initialGranted);
  const dirty = granted.size !== initial.size || [...granted].some((id) => !initial.has(id));

  const filtered = q.trim()
    ? users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q.trim().toLowerCase()))
    : users;

  function toggle(id: string) {
    setGranted((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const saved = await onSave({ ids: [...granted] });
      setGranted(new Set(saved));
      setMsg("Saved.");
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input className="h-8 w-64" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex items-center gap-2">
            {msg && <span className="text-xs text-emerald-600">{msg}</span>}
            <Button size="sm" className="h-8" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
        <div className="divide-y rounded-md border">
          {filtered.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-3 p-2.5 text-sm hover:bg-accent/40">
              <input type="checkbox" className="accent-[#ED1C24]" checked={granted.has(u.id)} onChange={() => toggle(u.id)} />
              <span className="flex-1">
                <span className="font-medium">{u.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{u.email} · {u.role}</span>
              </span>
              {granted.has(u.id) && <span className="text-xs font-medium text-emerald-600">Can view</span>}
            </label>
          ))}
          {filtered.length === 0 && <p className="p-3 text-center text-sm text-muted-foreground">No users match.</p>}
        </div>
        <p className="text-xs text-muted-foreground">Admins and each quote&apos;s own preparer can always view documents — you don&apos;t need to grant them here.</p>
      </CardContent>
    </Card>
  );
}
