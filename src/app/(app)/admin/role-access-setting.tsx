"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GATEABLE_ROLES } from "@/lib/role-access";

/**
 * Admin panel to enable/disable whole roles from accessing AeroERP. Toggle one or
 * several roles; a disabled role's users are blocked from every feature and
 * setting. Admins are always enabled (shown locked) so you can't lock yourself out.
 */
export function RoleAccessSetting({
  initialDisabled,
  onSave,
}: {
  initialDisabled: string[];
  onSave: (input: { disabled: string[] }) => Promise<string[]>;
}) {
  const [disabled, setDisabled] = useState<Set<string>>(new Set(initialDisabled));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(role: string) {
    const next = new Set(disabled);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setBusy(role);
    setErr(null);
    setMsg(null);
    try {
      const saved = await onSave({ disabled: [...next] });
      setDisabled(new Set(saved));
      setMsg(`${role} ${next.has(role) ? "disabled" : "enabled"}.`);
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Role access — enable / disable AeroERP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Turn a role off to block its users from all AeroERP features and settings — they stay signed in
          but see an &ldquo;access disabled&rdquo; screen until you turn it back on. Admins are always enabled.
        </p>
        <div className="divide-y rounded-md border">
          {/* Admin — always enabled, shown locked. */}
          <div className="flex items-center justify-between gap-3 p-2.5">
            <div>
              <div className="text-sm font-medium">Admin</div>
              <div className="text-xs text-muted-foreground">Full access — cannot be disabled.</div>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Always on</span>
          </div>
          {GATEABLE_ROLES.map((r) => {
            const on = !disabled.has(r.key);
            return (
              <div key={r.key} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-xs font-medium ${on ? "text-emerald-600" : "text-destructive"}`}>{on ? "Enabled" : "Disabled"}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={busy !== null}
                    onClick={() => toggle(r.key)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"} ${busy === r.key ? "opacity-60" : ""}`}
                  >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {msg && <p className="text-xs text-emerald-600">{msg}</p>}
        {err && <p className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
