"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaymentTerm } from "@/lib/payment-terms";

type SaveFn = (input: { id?: string; text: string }) => Promise<PaymentTerm[]>;
type DeleteFn = (id: string) => Promise<PaymentTerm[]>;

export function PaymentTermsManager({
  terms,
  onSave,
  onDelete,
}: {
  terms: PaymentTerm[];
  onSave: SaveFn;
  onDelete: DeleteFn;
}) {
  const [list, setList] = useState<PaymentTerm[]>(terms);
  const [add, setAdd] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<PaymentTerm[]>, after?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      setList(await fn());
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
        <div className="text-sm font-medium">Add a payment term</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 flex-1 min-w-[16rem]" placeholder="e.g. 30 days upon delivery" value={add} onChange={(e) => setAdd(e.target.value)} />
          <Button size="sm" className="h-8" disabled={busy || !add.trim()} onClick={() => run(() => onSave({ text: add }), () => setAdd(""))}>
            {busy ? "Saving…" : "Add term"}
          </Button>
        </div>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment terms yet. Add one above, or save one from the Purchase Order form.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="py-2 px-3 font-medium">Payment term</th>
                <th className="py-2 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) =>
                editId === t.id ? (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-1.5 px-2"><Input className="h-8" value={edit} onChange={(e) => setEdit(e.target.value)} /></td>
                    <td className="py-1.5 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" className="h-7 text-xs" disabled={busy || !edit.trim()} onClick={() => run(() => onSave({ id: t.id, text: edit }), () => setEditId(null))}>Save</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setEditId(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 px-3">{t.text}</td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditId(t.id); setEdit(t.text); }}>Edit</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => run(() => onDelete(t.id))}>Remove</Button>
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
