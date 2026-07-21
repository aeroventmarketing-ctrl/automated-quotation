"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EMPTY_DUCT_JO,
  EMPTY_DUCT_SEGMENT,
  formatDuctJoNumber,
  formatSegmentDimensions,
  DUCT_MATERIALS,
  DUCT_GAUGES,
  DUCT_UOMS,
  type DuctJobOrder,
  type DuctSegment,
} from "@/lib/duct-job-order";
import { saveDuctJobOrder, deleteDuctJobOrder } from "../actions";

const SELECT_CLS = "h-8 w-full rounded-md border bg-background px-2 text-sm";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function DuctJobOrderPanel({
  orderId,
  jobOrders,
  baseNo,
  baseYear,
  canManage,
  canAdd = canManage,
}: {
  orderId: string;
  jobOrders: DuctJobOrder[];
  baseNo?: number;
  baseYear?: number;
  canManage: boolean;
  /** Whether new job orders can still be added (hidden once in production). */
  canAdd?: boolean;
}) {
  const router = useRouter();
  const [editIndex, setEditIndex] = useState<number | null>(null); // null = list; -1 = new
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const year = baseYear ?? new Date().getFullYear();
  const total = jobOrders.length;
  const numberFor = (i: number) => (baseNo != null ? formatDuctJoNumber(baseNo, year, i, total) : "—");

  if (editIndex !== null) {
    const editing = editIndex >= 0;
    const initial = editing ? jobOrders[editIndex] : { ...EMPTY_DUCT_JO, date: todayISO() };
    return (
      <DuctJobOrderForm
        orderId={orderId}
        index={editing ? editIndex : null}
        initial={initial}
        onDone={() => { setEditIndex(null); router.refresh(); }}
        onCancel={() => setEditIndex(null)}
      />
    );
  }

  async function remove(i: number) {
    if (!confirm("Delete this duct job order?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteDuctJobOrder(orderId, i);
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
        <p className="text-xs text-muted-foreground">No duct job order yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobOrders.map((jo, i) => (
            <li key={i} className="space-y-1 rounded-md border bg-muted/20 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{numberFor(i)}</span>
                <span className="rounded-full bg-[#ED1C24]/10 px-2 py-0.5 font-medium text-[#ED1C24]">Duct</span>
                <span className="text-muted-foreground">
                  {[jo.project, jo.segments.length ? `${jo.segments.length} segment${jo.segments.length > 1 ? "s" : ""}` : null, jo.dueDate && `due ${jo.dueDate}`].filter(Boolean).join(" · ")}
                </span>
                <a
                  href={`/orders/${orderId}/jo-duct/${i}/xlsx`}
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
          <Plus className="mr-1 h-3.5 w-3.5" /> Add duct job order
        </Button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function DuctJobOrderForm({
  orderId,
  index,
  initial,
  onDone,
  onCancel,
}: {
  orderId: string;
  index: number | null;
  initial: DuctJobOrder;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<DuctJobOrder>({ ...initial, segments: initial.segments.length ? initial.segments : [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof DuctJobOrder, v: string) => setF((p) => ({ ...p, [k]: v }));

  const addSegment = (kind: DuctSegment["kind"]) => {
    setF((p) => {
      // Carry over material/gauge from the last segment for convenience.
      const last = p.segments[p.segments.length - 1];
      const seg: DuctSegment = {
        ...EMPTY_DUCT_SEGMENT,
        kind,
        material: last?.material || EMPTY_DUCT_SEGMENT.material,
        gauge: last?.gauge || EMPTY_DUCT_SEGMENT.gauge,
      };
      return { ...p, segments: [...p.segments, seg] };
    });
  };
  const setSeg = (i: number, patch: Partial<DuctSegment>) =>
    setF((p) => ({ ...p, segments: p.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const removeSeg = (i: number) => setF((p) => ({ ...p, segments: p.segments.filter((_, j) => j !== i) }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveDuctJobOrder(orderId, index, f);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">{index != null ? "Edit" : "New"} Duct Job Order</div>

      <div className="text-xs font-semibold text-muted-foreground">Header</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Qty</span>
            <Input className="h-8" value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">UOM</span>
            <select className={SELECT_CLS} value={f.uom} onChange={(e) => set("uom", e.target.value)}>
              {DUCT_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Segments — (Horizontal x Vertical x Length)</span>
      </div>
      <div className="space-y-2">
        {f.segments.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No segments yet — add a straight duct or a reducer below.</p>
        )}
        {f.segments.map((seg, i) => (
          <div key={i} className="space-y-1.5 rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground">{i + 1}.</span>
              <select
                className="h-7 rounded-md border bg-background px-2 text-xs font-medium"
                value={seg.kind}
                onChange={(e) => setSeg(i, { kind: e.target.value as DuctSegment["kind"] })}
              >
                <option value="straight">Straight duct</option>
                <option value="reducer">Reducer duct</option>
              </select>
              <span className="text-[11px] text-muted-foreground truncate">{formatSegmentDimensions(seg)}</span>
              <button type="button" onClick={() => removeSeg(i)} className="ml-auto text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              <SegField label="Horizontal" value={seg.horizontal} onChange={(v) => setSeg(i, { horizontal: v })} />
              <SegField label="Vertical" value={seg.vertical} onChange={(v) => setSeg(i, { vertical: v })} />
              {seg.kind === "reducer" ? (
                <>
                  <SegField label="→ Horizontal" value={seg.toHorizontal} onChange={(v) => setSeg(i, { toHorizontal: v })} />
                  <SegField label="→ Vertical" value={seg.toVertical} onChange={(v) => setSeg(i, { toVertical: v })} />
                  <SegField label="Length (mm)" value={seg.length} onChange={(v) => setSeg(i, { length: v })} />
                </>
              ) : (
                <SegField label="Length (mm)" value={seg.length} onChange={(v) => setSeg(i, { length: v })} />
              )}
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Material</span>
                <select className="h-7 w-full rounded-md border bg-background px-1 text-xs" value={seg.material} onChange={(e) => setSeg(i, { material: e.target.value })}>
                  {DUCT_MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Gauge</span>
                <select className="h-7 w-full rounded-md border bg-background px-1 text-xs" value={seg.gauge} onChange={(e) => setSeg(i, { gauge: e.target.value })}>
                  {DUCT_GAUGES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addSegment("straight")}>
            <Plus className="mr-1 h-3 w-3" /> Straight duct
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => addSegment("reducer")}>
            <ArrowDownUp className="mr-1 h-3 w-3" /> Reducer duct
          </Button>
        </div>
      </div>

      <div className="text-xs font-semibold text-muted-foreground">Note / Remarks</div>
      <textarea
        className="min-h-[52px] w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        value={f.note}
        onChange={(e) => set("note", e.target.value)}
        placeholder="e.g. Center Reducer / Flat bottom"
      />
      <p className="text-[11px] text-muted-foreground">The note is printed on the job order and shown on the order for conversation & remarks.</p>

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

function SegField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input className="h-7 text-xs" value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" />
    </label>
  );
}
