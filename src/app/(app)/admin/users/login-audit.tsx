"use client";

import { useState } from "react";
import { auditLogins, type LoginAudit } from "../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function LoginAuditCard() {
  const [data, setData] = useState<LoginAudit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await auditLogins();
    setBusy(false);
    if ("error" in res) {
      setErr(res.error);
      setData(null);
    } else {
      setData(res);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Login check (app users ↔ Supabase Auth)</CardTitle>
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? "Checking…" : "Check logins"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {err && <p className="text-destructive">{err}</p>}
        {data && (
          <>
            <p className="text-xs text-muted-foreground">
              {data.appUsers} app users · {data.authUsers} Supabase Auth logins
            </p>

            <div>
              <p className="font-medium">App users without a login ({data.missingLogin.length})</p>
              <p className="mb-1 text-xs text-muted-foreground">
                These people can&apos;t sign in yet. Use <span className="font-medium">Set password</span> on
                their row to create the login.
              </p>
              {data.missingLogin.length === 0 ? (
                <p className="text-xs text-emerald-700">None — every app user has a login. ✓</p>
              ) : (
                <ul className="list-inside list-disc text-xs">
                  {data.missingLogin.map((u) => (
                    <li key={u.email}>
                      {u.name} — {u.email} <span className="text-muted-foreground">({u.role})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="font-medium">Logins without an app user ({data.orphanAuth.length})</p>
              <p className="mb-1 text-xs text-muted-foreground">
                These Supabase logins have no matching app user — signing in with them causes the
                redirect loop. Add an app user with that email above, or delete the login in Supabase.
              </p>
              {data.orphanAuth.length === 0 ? (
                <p className="text-xs text-emerald-700">None — every login maps to an app user. ✓</p>
              ) : (
                <ul className="list-inside list-disc text-xs">
                  {data.orphanAuth.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
