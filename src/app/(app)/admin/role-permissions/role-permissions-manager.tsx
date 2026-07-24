"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CapabilityGroup } from "@/lib/role-permissions";

interface RoleOpt { key: string; label: string; group: string }

export function RolePermissionsManager({
  roles,
  groups,
  values,
  onSave,
}: {
  roles: RoleOpt[];
  groups: CapabilityGroup[];
  values: Record<string, Record<string, boolean>>;
  onSave: (role: string, caps: Record<string, boolean>) => Promise<void>;
}) {
  const [role, setRole] = useState(roles[0]?.key ?? "");
  const [state, setState] = useState<Record<string, Record<string, boolean>>>(values);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Role dropdown grouped by role group.
  const roleGroups = useMemo(() => {
    const m = new Map<string, RoleOpt[]>();
    for (const r of roles) { const a = m.get(r.group) ?? []; a.push(r); m.set(r.group, a); }
    return [...m.entries()];
  }, [roles]);

  const cur = state[role] ?? {};
  const setCap = (cap: string, v: boolean) => {
    setSaved(false);
    setState((s) => ({ ...s, [role]: { ...(s[role] ?? {}), [cap]: v } }));
  };
  const setGroup = (keys: string[], v: boolean) => {
    setSaved(false);
    setState((s) => ({ ...s, [role]: { ...(s[role] ?? {}), ...Object.fromEntries(keys.map((k) => [k, v])) } }));
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try { await onSave(role, state[role] ?? {}); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to save"); }
    finally { setBusy(false); }
  };

  const roleLabel = roles.find((r) => r.key === role)?.label ?? role;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Role</label>
        <select value={role} onChange={(e) => { setRole(e.target.value); setSaved(false); }} className="h-9 rounded-md border bg-background px-2 text-sm">
          {roleGroups.map(([g, rs]) => (
            <optgroup key={g} label={g}>
              {rs.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <Button size="sm" className="h-9" disabled={busy} onClick={save}>{busy ? "Saving…" : `Save ${roleLabel}`}</Button>
        </div>
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium">Client-data restrictions</span> (marked <span className="rounded bg-emerald-100 px-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Live</span>) take effect immediately — they drive what {roleLabel} can see. The remaining <span className="font-medium">task permissions</span> are recorded policy for each role; tell me which to wire into enforcement and I&rsquo;ll gate the matching actions.
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {groups.map((g) => {
          const keys = g.items.map((i) => i.key);
          const allOn = keys.every((k) => cur[k]);
          return (
            <div key={g.group} className={`rounded-lg border p-3 ${g.kind === "restriction" ? "border-amber-300 dark:border-amber-900" : ""}`}>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">{g.group}</div>
                <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setGroup(keys, !allOn)}>{allOn ? "Clear all" : "Select all"}</button>
              </div>
              <div className="space-y-1.5">
                {g.items.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={!!cur[c.key]} onChange={(e) => setCap(c.key, e.target.checked)} />
                    <span>{c.label}</span>
                    {c.enforced && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Live</span>}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
