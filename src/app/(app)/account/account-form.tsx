"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AccountForm({ email }: { email: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setMsg(null);
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      setMsg("Password updated.");
      setPw("");
      setPw2("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <p className="text-sm text-muted-foreground">Update the login password for {email}.</p>
      </CardHeader>
      <CardContent className="grid max-w-2xl items-end gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label>New password</Label>
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 8 characters" />
        </div>
        <div className="space-y-1">
          <Label>Confirm password</Label>
          <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <Button onClick={save} disabled={busy || !pw}>{busy ? "Saving…" : "Update password"}</Button>
        {err && <p className="text-sm text-destructive md:col-span-3">{err}</p>}
        {msg && <p className="text-sm text-emerald-700 md:col-span-3">{msg}</p>}
      </CardContent>
    </Card>
  );
}
