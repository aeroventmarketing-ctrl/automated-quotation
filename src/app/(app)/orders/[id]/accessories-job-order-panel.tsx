"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EMPTY_ACCESSORIES_JO,
  EMPTY_ACCESSORY_LINE,
  formatAccessoriesJoNumber,
  formatAccessoryLine,
  ACCESSORY_TYPE_SUGGESTIONS,
  ACCESSORY_MATERIALS,
  ACCESSORY_UOMS,
  type AccessoriesJobOrder,
  type AccessoryLine,
} from "@/lib/accessories-job-order";
import { saveAccessoriesJobOrder, deleteAccessoriesJobOrder } from "../actions";

const SELECT_CLS = "h-8 w-full rounded-md border bg-background px-2 text-sm";
const TYPES_LIST_ID = "acc-type-suggestions";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function AccessoriesJobOrderPanel({
  orderId,
  jobOrders,
  baseNo,
  baseYear,
  canManage,
  canAdd = canManage,
}: {
  orderId: string;
  jobOrders: AccessoriesJobOrder[];
  baseNo?: number;
  baseYear?: number;
  canManage: boolean;
  canAdd?: boolean;
}) {
  const router = useRouter();
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const year = baseYear ?? new Date().getFullYear();
  const total = jobOrders.length;
  const numberFor = (i: number) => (baseNo != null ? formatAccessoriesJoNumber(baseNo, year, i, total) : "—");

  if (editIndex !== null) {
    const editing = editIndex >= 0;
    const initial = editing ? jobOrders[editIndex] : { ...EMPTY_ACCESSORIES_JO, date: todayISO() };
    return (
      <AccessoriesJobOrderForm
        orderId={orderId}
        index={editing ? editIndex : null}
        initial={initial}
        onDone={() => { setEditIndex(null); router.refresh(); }}
        onCancel={() => setEditIndex(null)}
      />
    );
  }

  async function remove(i: number) {
    if (!confirm("Delete this accessories job order?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteAccessoriesJobOrder(orderId, i);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {jobOrders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No accessories job order yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobOrders.map((jo, i) => (
            <li key={i} className="space-y-1 rounded-md border bg-muted/20 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{numberFor(i)}</span>
                <span className="rounded-full bg-[#ED1C24]/10 px-2 py-0.5 font-medium text-[#ED1C24]">Accessories</span>
                <span className="text-muted-foreground">
                  {[jo.project, jo.lines.length ? `${jo.lines.length} product${jo.lines.length > 1 ? "s" : ""}` : null, jo.dueDate && `due ${jo.dueDate}`].filter(Boolean).join(" · ")}
                </span>
                <a
                  href={`/orders/${orderId}/jo-acc/${i}/xlsx`}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a]"
                >
                  <Printer className="h-3.5 w-3.5" /> Print Job Order
                </a>
                {canManage && (
                  <>
                    <button type="button" onClick={() => setEditIndex(i)} className="inline-flex items-center gap-1 rounded-md border border-[#ED1C24] px-2 py-1.5 font-semibold text-[#ED1C24] hover:bg-[#ED1C24]/10">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button type="button" disabled={busy} onClick={() => remove(i)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
              {jo.note && <p className="text-[11px] text-muted-foreground"><span className="font-medium">Note:</span> {jo.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditIndex(-1)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add accessories job order
        </Button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function AccessoriesJobOrderForm({
  orderId,
  index,
  initial,
  onDone,
  onCancel,
}: {
  orderId: string;
  index: number | null;
  initial: AccessoriesJobOrder;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<AccessoriesJobOrder>({ ...initial, lines: initial.lines.length ? initial.lines : [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof AccessoriesJobOrder, v: string) => setF((p) => ({ ...p, [k]: v }));

  const addLine = () => {
    setF((p) => {
      const last = p.lines[p.lines.length - 1];
      const line: AccessoryLine = {
        ...EMPTY_ACCESSORY_LINE,
        dimensions: [{ value: "", label: "" }],
        material: last?.material || EMPTY_ACCESSORY_LINE.material,
        uom: last?.uom || EMPTY_ACCESSORY_LINE.uom,
      };
      return { ...p, lines: [...p.lines, line] };
    });
  };
  const setLine = (i: number, patch: Partial<AccessoryLine>) =>
    setF((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const removeLine = (i: number) => setF((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }));
  const setDim = (li: number, di: number, patch: Partial<{ value: string; label: string }>) =>
    setF((p) => ({
      ...p,
      lines: p.lines.map((l, j) =>
        j === li ? { ...l, dimensions: l.dimensions.map((d, k) => (k === di ? { ...d, ...patch } : d)) } : l,
      ),
    }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveAccessoriesJobOrder(orderId, index, f);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <datalist id={TYPES_LIST_ID}>
        {ACCESSORY_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
      </datalist>
      <div className="text-sm font-medium">{index != null ? "Edit" : "New"} Accessories Job Order</div>

      <div className="text-xs font-semibold text-muted-foreground">Header</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Project</span>
          <Input className="h-8" value={f.project} onChange={(e) => set("project", e.target.value)} placeholder="e.g. CEB" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Date</span>
          <Input className="h-8" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Due date</span>
          <Input className="h-8" type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </label>
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Products</div>
      <div className="space-y-2">
        {f.lines.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No products yet — click &ldquo;Add product&rdquo; below.</p>
        )}
        {f.lines.map((line, i) => (
          <div key={i} className="space-y-2 rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground">{i + 1}.</span>
              <Input
                className="h-7 flex-1 text-xs"
                list={TYPES_LIST_ID}
                value={line.type}
                placeholder="Product type — e.g. Linear Bar Grille"
                onChange={(e) => setLine(i, { type: e.target.value })}
              />
              <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Qty</span>
                <Input className="h-7 text-xs" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputMode="numeric" />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">UOM</span>
                <select className="h-7 w-full rounded-md border bg-background px-1 text-xs" value={line.uom} onChange={(e) => setLine(i, { uom: e.target.value })}>
                  {ACCESSORY_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="space-y-0.5 sm:col-span-2">
                <span className="text-[10px] text-muted-foreground">Material</span>
                <select className="h-7 w-full rounded-md border bg-background px-1 text-xs" value={line.material} onChange={(e) => setLine(i, { material: e.target.value })}>
                  <option value="">Material…</option>
                  {ACCESSORY_MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
                  {line.material && !ACCESSORY_MATERIALS.includes(line.material) && <option value={line.material}>{line.material}</option>}
                </select>
              </label>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Dimensions — two required (value &amp; label, e.g. &ldquo;450 mm&rdquo; / &ldquo;Horizontal Blade&rdquo;)</span>
              {[0, 1].map((di) => {
                const d = line.dimensions[di] ?? { value: "", label: "" };
                return (
                  <div key={di} className="flex items-center gap-1.5">
                    <Input className="h-7 w-24 shrink-0 text-xs sm:w-32" value={d.value} placeholder="450 mm" onChange={(e) => setDim(i, di, { value: e.target.value })} />
                    <span className="text-[10px] text-muted-foreground">-</span>
                    <Input className="h-7 min-w-0 flex-1 text-xs" value={d.label} placeholder={di === 0 ? "Horizontal Blade" : "Neck size"} onChange={(e) => setDim(i, di, { label: e.target.value })} />
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground">{formatAccessoryLine(line)}</p>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addLine}>
          <Plus className="mr-1 h-3 w-3" /> Add product
        </Button>
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Note / Remarks</div>
      <textarea
        className="min-h-[52px] w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        value={f.note}
        onChange={(e) => set("note", e.target.value)}
        placeholder="e.g. remarks from the client…"
      />
      <p className="text-[11px] text-muted-foreground">The note is printed on the job order and shown on the order for conversation &amp; remarks.</p>

      <div className="text-xs font-semibold text-muted-foreground">Assignment</div>
      <label className="space-y-1 block">
        <span className="text-[11px] text-muted-foreground">Assigned personnel (not printed on the JO)</span>
        <Input className="h-8" value={f.assignedPersonnel} onChange={(e) => set("assignedPersonnel", e.target.value)} />
      </label>

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={save}>{busy ? "Saving…" : index != null ? "Save changes" : "Create job order"}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
