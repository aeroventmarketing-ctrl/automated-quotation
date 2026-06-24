"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  // One client instance so the recovery session detected from the URL is reused.
  const [supabase] = useState(() => createClient());
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  // The recovery link establishes a session via detectSessionInUrl; wait for it.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1800);
    } catch {
      setError("Could not update the password. Try opening the reset link again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/aerovent-logo.jpg"
            alt="Aerovent Fans and Blowers Manufacturing"
            className="mx-auto h-auto w-full max-w-[280px]"
          />
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4 text-center">
              <p className="text-sm">Password updated. Redirecting to sign in…</p>
              <Link href="/login" className="text-sm text-primary underline">
                Go to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">Set a new password for your account.</p>
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={show ? "text" : "password"}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="min 8 characters"
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password2">Confirm new password</Label>
                <Input
                  id="password2"
                  type={show ? "text" : "password"}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {!ready && (
                <p className="text-xs text-muted-foreground">
                  Waiting for the reset link to be verified… If this doesn&apos;t complete, open the
                  link from your email again on this device.
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
              <div className="text-center">
                <Link href="/login" className="text-xs text-muted-foreground underline hover:text-foreground">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
