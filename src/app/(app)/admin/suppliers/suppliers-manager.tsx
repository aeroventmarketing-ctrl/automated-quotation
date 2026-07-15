"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Supplier } from "@/lib/suppliers";

type SaveFn = (input: { id?: string; company: string; attention: string; address: string }) => Promise<Supplier[]>;
type DeleteFn = (id: string) => Promise<Supplier[]>;

const blank = { company: "", attention: "", address: "" };

export function SuppliersManager({
  suppliers,
  onSave,
  onDelete,
}: {
  suppliers: Supplier[];
  onSave: SaveFn;
  onDelete: DeleteFn;
}) {
  const [list, setList] = useState<Supplier[]>(suppliers);
  const [add, setAdd] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<Supplier[]>, after?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      const next = await fn();
      setList(next);
      after?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Add new */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Add a supplier</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input className="h-8" placeholder="Company name" value={add.company} onChange={(e) => setAdd({ ...add, company: e.target.value })} />
          <Input className="h-8" placeholder="Attention (contact + number)" value={add.attention} onChange={(e) => setAdd({ ...add, attention: e.target.value })} />
          <Input className="h-8" placeholder="Address" value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} />
        </div>
        <Button size="sm" className="h-8" disabled={busy || !add.company.trim()}
          onClick={() => run(() => onSave(add), () => setAdd(blank))}>
          {busy ? "Saving…" : "Add supplier"}
        </Button>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No suppliers yet. Add one above, or issue a Purchase Order and the supplier is saved automatically.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="py-2 px-3 font-medium">Company</th>
                <th className="py-2 px-3 font-medium">Attention</th>
                <th className="py-2 px-3 font-medium">Address</th>
                <th className="py-2 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) =>
                editId === s.id ? (
                  <tr key={s.id} className="border-b last:border-0 align-top">
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.attention} onChange={(e) => setEdit({ ...edit, attention: e.target.value })} /></td>
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></td>
                    <td className="py-1.5 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" className="h-7 text-xs" disabled={busy || !edit.company.trim()} onClick={() => run(() => onSave({ id: s.id, ...edit }), () => setEditId(null))}>Save</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 px-3 font-medium">{s.company}</td>
                    <td className="py-2 px-3 text-muted-foreground">{s.attention || "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{s.address || "—"}</td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditId(s.id); setEdit({ company: s.company, attention: s.attention, address: s.address }); }}>Edit</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => onDelete(s.id))}>Remove</Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
