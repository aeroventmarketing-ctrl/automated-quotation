"use client";

import { useState, useTransition } from "react";
import { addFanCogs, updateFanCogs, deleteFanCogs, bulkUpsertFanCogs, type FanCogsRowView, type FanCogsBulkRow } from "./fan-cogs-actions";

const MATERIALS = ["Black Iron Sheet", "Galvanized Iron", "Stainless Steel", "Aluminum"];

const isNum = (v: string) => v.trim() !== "" && Number.isFinite(Number(v.trim()));

/**
 * Parse a fabricated-fan COGS grid pasted from the spreadsheet. Each block is a
 * code header line (e.g. "CEB" or "EWF / FAWF"), a "Sizes" row, then a values
 * row aligned by column. Blank cells are skipped. Returns (code, size, cost) rows.
 */
function parseCogsGrid(text: string): FanCogsBulkRow[] {
  const out: FanCogsBulkRow[] = [];
  let codes: string[] = [];
  let sizes: string[] = [];
  let expectValues = false;
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split("\t").map((c) => c.trim());
    if (!cells.some(Boolean)) continue;
    const first = cells[0];
    if (/^sizes$/i.test(first)) {
      sizes = cells.slice(1);
      expectValues = true;
      continue;
    }
    if (expectValues) {
      const vals = cells.slice(1);
      for (let i = 0; i < sizes.length; i++) {
        if (isNum(sizes[i]) && isNum(vals[i] ?? "")) {
          const size = String(Number(sizes[i]));
          for (const code of codes) out.push({ modelCode: code, size, cost: Number(vals[i]) });
        }
      }
      expectValues = false;
      continue;
    }
    // Code header — take the first non-empty cell, split "A / B" into two codes.
    const label = cells.find(Boolean) ?? "";
    codes = label.split(/[/,]/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9]{2,10}$/.test(c));
  }
  return out;
}

export function FanCogsEditor({ initial }: { initial: FanCogsRowView[] }) {
  const [rows, setRows] = useState<FanCogsRowView[]>(initial);
  const [modelCode, setModelCode] = useState("");
  const [size, setSize] = useState("");
  const [material, setMaterial] = useState("");
  const [cost, setCost] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
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

  const parsed = paste.trim() ? parseCogsGrid(paste) : [];
  const importGrid = () =>
    refresh(async () => {
      const res = await bulkUpsertFanCogs(parsed);
      setPaste("");
      setPasteMsg(`Imported ${res.added + res.updated} cost${res.added + res.updated === 1 ? "" : "s"} (${res.added} new, ${res.updated} updated).`);
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
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : <span className="text-[11px] text-muted-foreground">Fabricated fans match by fan code (CEB, TAF …) + size; the same material / customized / double-wall factors then scale the cost. A model code alone, or size + material, is used as a fixed fallback.</span>}
        <button onClick={add} disabled={pending || (!modelCode && !size && !material)} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">Add row</button>
      </div>

      {/* Bulk paste from the fabricated-fan COGS spreadsheet */}
      <details className="rounded-md border bg-muted/20 p-2">
        <summary className="cursor-pointer text-xs font-medium">Bulk paste from spreadsheet (code × size grid)</summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Copy the grid straight from Excel — a code header (e.g. <code className="rounded bg-muted px-1">CEB</code> or <code className="rounded bg-muted px-1">EWF / FAWF</code>), a <code className="rounded bg-muted px-1">Sizes</code> row, then the cost row — and paste it here. These are base costs; the fan&rsquo;s material / customized / double-wall factors are applied on top automatically.
          </p>
          <textarea
            value={paste}
            onChange={(e) => { setPaste(e.target.value); setPasteMsg(null); }}
            rows={5}
            placeholder={"CEB\nSizes\t10.5\t12.25\t13.5\n\t\t15340\t17829"}
            className="w-full rounded-md border bg-background p-2 font-mono text-[11px]"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {pasteMsg ?? (parsed.length ? `${parsed.length} cost cell${parsed.length === 1 ? "" : "s"} detected` : "Nothing detected yet")}
            </span>
            <button onClick={importGrid} disabled={pending || parsed.length === 0} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">Import {parsed.length || ""} cost{parsed.length === 1 ? "" : "s"}</button>
          </div>
        </div>
      </details>
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
