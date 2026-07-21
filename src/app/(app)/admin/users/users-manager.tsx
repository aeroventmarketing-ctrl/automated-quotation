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
import { upsertUser, deleteUser, reassignAndDeleteUser, setUserPassword, saveUserSignature } from "../actions";

const ROLES = ["SALES", "ENGINEER", "ADMIN"];

interface U { id: string; email: string; name: string; role: string; salesCode: string; signature: string | null; workflowRoles: string[] }
interface WfRole { key: string; label: string; group: string }

/** Read an image file, downscale to ≤600px wide, and return a PNG data URL. */
function fileToSignatureDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) return reject(new Error("Please choose a PNG or JPEG image."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 600 / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported in this browser."));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the image.")); };
    img.src = url;
  });
}

export function UsersManager({ users, workflowRoleOptions }: { users: U[]; workflowRoleOptions: WfRole[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("SALES");
  const [salesCode, setSalesCode] = useState("");
  const [wfRoles, setWfRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Workflow roles grouped by their category (Finance / Production / Supply chain).
  const wfGroups = Array.from(new Set(workflowRoleOptions.map((r) => r.group)))
    .map((g) => ({ group: g, roles: workflowRoleOptions.filter((r) => r.group === g) }));
  const roleLabel = (key: string) => workflowRoleOptions.find((r) => r.key === key)?.label ?? key;
  const toggleWf = (key: string) => setWfRoles((rs) => (rs.includes(key) ? rs.filter((r) => r !== key) : [...rs, key]));

  function reset() {
    setEditingId(null); setEmail(""); setName(""); setRole("SALES"); setSalesCode(""); setWfRoles([]); setError(null);
  }
  function edit(u: U) {
    setEditingId(u.id); setEmail(u.email); setName(u.name); setRole(u.role); setSalesCode(u.salesCode); setWfRoles(u.workflowRoles); setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await upsertUser({ id: editingId ?? undefined, email, name, role: role as never, salesCode, workflowRoles: wfRoles });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const [delErr, setDelErr] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState<string | null>(null);
  // Reassign-then-delete: opened when a delete is blocked by linked history.
  const [reUser, setReUser] = useState<U | null>(null);
  const [reNote, setReNote] = useState<string | null>(null);
  const [reTo, setReTo] = useState("");
  const [reBusy, setReBusy] = useState(false);
  const [reErr, setReErr] = useState<string | null>(null);

  async function remove(u: U) {
    if (!confirm(`Delete ${u.name}?`)) return;
    setDelErr(null);
    setDelBusy(u.id);
    try {
      const res = await deleteUser(u.id);
      if (res && "error" in res) {
        if ("reassignable" in res && res.reassignable) { openReassign(u, res.error); }
        else setDelErr(res.error);
        return;
      }
      router.refresh();
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDelBusy(null);
    }
  }

  function openReassign(u: U, note?: string) {
    setReUser(u);
    setReNote(note ?? null);
    setReErr(null);
    setReTo(users.find((x) => x.id !== u.id)?.id ?? "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function doReassignDelete() {
    if (!reUser) return;
    if (!reTo) { setReErr("Choose a user to receive the records."); return; }
    setReErr(null);
    setReBusy(true);
    try {
      const res = await reassignAndDeleteUser(reUser.id, reTo);
      if (res && "error" in res) { setReErr(res.error); return; }
      setReUser(null);
      router.refresh();
    } catch (e) {
      setReErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setReBusy(false);
    }
  }

  // --- Signature upload ---
  const [sigBusy, setSigBusy] = useState<string | null>(null);
  const [sigErr, setSigErr] = useState<string | null>(null);

  async function onSignatureFile(userId: string, file: File | null) {
    if (!file) return;
    setSigErr(null);
    setSigBusy(userId);
    try {
      const dataUrl = await fileToSignatureDataUrl(file);
      await saveUserSignature({ userId, dataUrl });
      router.refresh();
    } catch (e) {
      setSigErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSigBusy(null);
    }
  }
  async function removeSignature(userId: string) {
    setSigErr(null);
    setSigBusy(userId);
    try {
      await saveUserSignature({ userId, dataUrl: null });
      router.refresh();
    } catch (e) {
      setSigErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setSigBusy(null);
    }
  }

  // --- Password reset ---
  const [pwUser, setPwUser] = useState<U | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  function openPw(u: U) {
    setPwUser(u); setPw(""); setPw2(""); setPwMsg(null); setPwErr(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function savePw() {
    setPwErr(null); setPwMsg(null);
    if (pw.length < 8) { setPwErr("Password must be at least 8 characters."); return; }
    if (pw !== pw2) { setPwErr("Passwords don't match."); return; }
    if (!pwUser) return;
    setPwBusy(true);
    try {
      const res = await setUserPassword({ email: pwUser.email, password: pw });
      if ("error" in res) {
        setPwErr(res.error);
      } else {
        setPwMsg(`Password updated for ${pwUser.email}.`);
        setPw(""); setPw2("");
      }
    } catch (e) {
      setPwErr(e instanceof Error ? e.message : "Failed to set password");
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{editingId ? "Edit user" : "Add / update user"}</CardTitle></CardHeader>
        <CardContent className="grid items-end gap-3 md:grid-cols-5">
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
          <div className="space-y-1">
            <Label>Quote letter</Label>
            <Input value={salesCode} maxLength={1} onChange={(e) => setSalesCode(e.target.value.toUpperCase())} placeholder="J" />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={busy || !email || !name}>
              {busy ? "Saving…" : editingId ? "Update" : "Save"}
            </Button>
            {editingId && (
              <Button variant="ghost" onClick={reset} disabled={busy}>Cancel</Button>
            )}
          </div>
          <div className="space-y-2 md:col-span-5">
            <Label className="text-xs">Workflow (ERP) roles</Label>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {wfGroups.map((g) => (
                <div key={g.group} className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</div>
                  {g.roles.map((r) => (
                    <label key={r.key} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="h-3.5 w-3.5 rounded border-input accent-primary" checked={wfRoles.includes(r.key)} onChange={() => toggleWf(r.key)} />
                      {r.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Assign the departmental roles that drive the workflows (Purchasing, Requisitions, Cash requests, orders). A user can hold several.</p>
          </div>
          {error && <p className="text-sm text-destructive md:col-span-5">{error}</p>}
          <p className="text-xs text-muted-foreground md:col-span-5">
            Note: the base role &amp; workflow roles are matched by email. Create the matching login in
            Supabase Authentication.
          </p>
        </CardContent>
      </Card>

      {pwUser && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle>Set password — {pwUser.name} ({pwUser.email})</CardTitle></CardHeader>
          <CardContent className="grid items-end gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>New password</Label>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 8 characters" />
            </div>
            <div className="space-y-1">
              <Label>Confirm password</Label>
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={savePw} disabled={pwBusy || !pw}>{pwBusy ? "Saving…" : "Set password"}</Button>
              <Button variant="ghost" onClick={() => setPwUser(null)} disabled={pwBusy}>Close</Button>
            </div>
            {pwErr && <p className="text-sm text-destructive md:col-span-4">{pwErr}</p>}
            {pwMsg && <p className="text-sm text-emerald-700 md:col-span-4">{pwMsg}</p>}
            <p className="text-xs text-muted-foreground md:col-span-4">
              Sets the Supabase Auth login password immediately — creating the login if the user
              doesn&apos;t have one yet. Share it with the user securely.
            </p>
          </CardContent>
        </Card>
      )}

      {reUser && (
        <Card className="border-destructive/40">
          <CardHeader><CardTitle>Reassign &amp; delete — {reUser.name} ({reUser.email})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {reNote && <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700">{reNote}</p>}
            <div className="grid items-end gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <Label>Reassign their quotations &amp; inquiries to</Label>
                <Select value={reTo} onChange={(e) => setReTo(e.target.value)}>
                  <option value="" disabled>Select a user…</option>
                  {users.filter((x) => x.id !== reUser.id).map((x) => (
                    <option key={x.id} value={x.id}>{x.name} ({x.email})</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="destructive" onClick={doReassignDelete} disabled={reBusy || !reTo}>
                  {reBusy ? "Working…" : "Reassign & delete"}
                </Button>
                <Button variant="ghost" onClick={() => setReUser(null)} disabled={reBusy}>Cancel</Button>
              </div>
            </div>
            {reErr && <p className="text-sm text-destructive">{reErr}</p>}
            <p className="text-xs text-muted-foreground">
              Their prepared &amp; approved quotations and created inquiries move to the selected user, then this
              account is deleted. This keeps the history intact and can&apos;t be undone.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {sigErr && <p className="mb-3 text-sm text-destructive">{sigErr}</p>}
          {delErr && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{delErr}</p>}
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Letter</TableHead><TableHead>Signature</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                    {u.workflowRoles.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.workflowRoles.map((k) => (
                          <span key={k} className="inline-flex rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary">{roleLabel(k)}</span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{u.salesCode || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {u.signature ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.signature} alt={`${u.name} signature`} className="h-8 max-w-[120px] rounded border bg-white object-contain" />
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                      <label className={`cursor-pointer text-xs font-medium text-primary hover:underline ${sigBusy === u.id ? "pointer-events-none opacity-60" : ""}`}>
                        {sigBusy === u.id ? "Saving…" : u.signature ? "Replace" : "Upload"}
                        <input type="file" accept="image/png,image/jpeg" className="hidden"
                          disabled={sigBusy === u.id}
                          onChange={(e) => { onSignatureFile(u.id, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                      </label>
                      {u.signature && (
                        <button type="button" className="text-xs text-destructive hover:underline disabled:opacity-60"
                          disabled={sigBusy === u.id} onClick={() => removeSignature(u.id)}>Remove</button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => edit(u)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => openPw(u)}>Password</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={delBusy === u.id} onClick={() => remove(u)}>{delBusy === u.id ? "Deleting…" : "Delete"}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            The signature appears above the sales person&apos;s name on every quotation they generate
            (Excel and PDF). PNG with a transparent background works best.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
