"use client";

import { useState } from "react";

interface RoleDef {
  key: string;
  label: string;
  group: string;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Admin grid: assign ERP workflow roles to users. Toggling saves immediately. */
export function WorkflowRolesManager({
  users,
  roles,
  initial,
  onSave,
}: {
  users: UserRow[];
  roles: RoleDef[];
  initial: Record<string, string[]>;
  onSave: (input: { userId: string; roles: string[] }) => Promise<string[]>;
}) {
  const [assign, setAssign] = useState<Record<string, string[]>>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(userId: string, roleKey: string) {
    const current = assign[userId] ?? [];
    const next = current.includes(roleKey)
      ? current.filter((r) => r !== roleKey)
      : [...current, roleKey];
    setBusy(userId);
    setErr(null);
    const prev = assign;
    setAssign({ ...assign, [userId]: next }); // optimistic
    try {
      const saved = await onSave({ userId, roles: next });
      setAssign((a) => ({ ...a, [userId]: saved }));
    } catch (e) {
      setAssign(prev); // revert
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="space-y-2">
        {users.map((u) => {
          const held = assign[u.id] ?? [];
          const saving = busy === u.id;
          return (
            <div key={u.id} className="rounded-md border p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">{u.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                </div>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {u.role}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => {
                  const on = held.includes(r.key);
                  return (
                    <button
                      key={r.key}
                      type="button"
                      disabled={saving}
                      onClick={() => toggle(u.id, r.key)}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      } ${saving ? "opacity-60" : ""}`}
                      title={r.group}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
