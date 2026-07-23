"use client";

import { useState, useTransition } from "react";
import { addFanCogs, updateFanCogs, deleteFanCogs, type FanCogsRowView } from "./fan-cogs-actions";

const MATERIALS = ["Black Iron Sheet", "Galvanized Iron", "Stainless Steel", "Aluminum"];

export function FanCogsEditor({ initial }: { initial: FanCogsRowView[] }) {
  const [rows, setRows] = useState<FanCogsRowView[]>(initial);
  const [modelCode, setModelCode] = useState("");
  const [size, setSize] = useState("");
  const [material, setMaterial] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = (mut: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await mut();
        const { listFanCogs } = await import("./fan-cogs-actions");
        setRows(await listFanCogs());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });

  const add = () =>
    refresh(async () => {
      await addFanCogs({ modelCode, size, material, cost: Number(cost) || 0 });
      setModelCode(""); setSize(""); setMaterial(""); setCost("");
    });

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Model code</th>
                <th className="py-1.5 text-left font-medium">Size (in)</th>
                <th className="py-1.5 text-left font-medium">Material</th>
                <th className="py-1.5 text-right font-medium">COGS</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FanCogsLine key={r.id} row={r} pending={pending} onSave={(c) => refresh(() => updateFanCogs(r.id, c))} onDelete={() => refresh(() => deleteFanCogs(r.id))} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add row */}
      <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-5">
        <input value={modelCode} onChange={(e) => setModelCode(e.target.value)} placeholder="Model code (override)" className="h-8 rounded-md border bg-background px-2 text-xs sm:col-span-2" />
        <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size (in)" className="h-8 rounded-md border bg-background px-2 text-xs" />
        <input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Material" list="fan-cogs-materials" className="h-8 rounded-md border bg-background px-2 text-xs" />
        <div className="flex gap-2">
          <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min={0} step="0.01" placeholder="COGS" className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs tabular-nums" />
        </div>
        <datalist id="fan-cogs-materials">{MATERIALS.map((m) => <option key={m} value={m} />)}</datalist>
      </div>
      <div className="flex items-center justify-between">
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : <span className="text-[11px] text-muted-foreground">Matched by model code first, else size + material. Enter the fan-body cost.</span>}
        <button onClick={add} disabled={pending || (!modelCode && !size && !material)} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">Add row</button>
      </div>
    </div>
  );
}

function FanCogsLine({ row, pending, onSave, onDelete }: { row: FanCogsRowView; pending: boolean; onSave: (cost: number) => void; onDelete: () => void }) {
  const [cost, setCost] = useState(String(row.cost));
  const dirty = Number(cost) !== row.cost;
  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 font-mono text-xs">{row.modelCode ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="py-1.5">{row.size ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="py-1.5">{row.material ?? <span className="text-muted-foreground">—</span>}</td>
      <td className="py-1.5 text-right">
        <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min={0} step="0.01" className="h-7 w-28 rounded-md border bg-background px-2 text-right text-xs tabular-nums" />
      </td>
      <td className="py-1.5 text-right">
        <div className="flex items-center justify-end gap-2">
          {dirty && <button onClick={() => onSave(Number(cost) || 0)} disabled={pending} className="text-xs font-medium text-primary disabled:opacity-50">Save</button>}
          <button onClick={onDelete} disabled={pending} className="text-xs text-muted-foreground hover:text-red-600 disabled:opacity-50">Remove</button>
        </div>
      </td>
    </tr>
  );
}
