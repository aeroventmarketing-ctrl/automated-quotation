"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { upsertUser, deleteUser } from "../actions";

const ROLES = ["SALES", "ENGINEER", "ADMIN"];

interface U { id: string; email: string; name: string; role: string }

export function UsersManager({ users }: { users: U[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("SALES");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await upsertUser({ email, name, role: role as never });
      setEmail(""); setName(""); setRole("SALES");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this user record?")) return;
    await deleteUser(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Add / update user</CardTitle></CardHeader>
        <CardContent className="grid items-end gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@aerovent.example" />
          </div>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
            </Select>
          </div>
          <Button onClick={save} disabled={busy || !email || !name}>{busy ? "Saving…" : "Save"}</Button>
          {error && <p className="text-sm text-destructive md:col-span-4">{error}</p>}
          <p className="text-xs text-muted-foreground md:col-span-4">
            Note: this manages the app role record (matched by email). Create the matching login in
            Supabase Authentication.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => remove(u.id)}>Delete</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
