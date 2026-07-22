"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2, Eye } from "lucide-react";
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
import { JobOrderApproval } from "./jo-approval";

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
                  href={`/orders/${orderId}/jo-acc/${i}/xlsx?view=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-semibold text-muted-foreground hover:bg-muted"
                >
                  <Eye className="h-3.5 w-3.5" /> View
                </a>
                <a
                  href={`/orders/${orderId}/jo-acc/${i}/xlsx`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a]"
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
              <JobOrderApproval orderId={orderId} dept="accessories" index={i} approvedByName={jo.approvedByName} canApprove={canManage} />
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
  // Line indices whose product type is being entered as a custom (free-text) value.
  const [customLines, setCustomLines] = useState<Set<number>>(() => {
    const s = new Set<number>();
    (initial.lines ?? []).forEach((l, i) => { if (l.type && !ACCESSORY_TYPE_SUGGESTIONS.includes(l.type)) s.add(i); });
    return s;
  });
  const set = (k: keyof AccessoriesJobOrder, v: string) => setF((p) => ({ ...p, [k]: v }));

  const addLine = () => {
    setF((p) => {
      const last = p.lines[p.lines.length - 1];
      const line: AccessoryLine = {
        ...EMPTY_ACCESSORY_LINE,
        dimensions: [{ value: "", label: "" }, { value: "", label: "" }],
        material: last?.material || EMPTY_ACCESSORY_LINE.material,
        uom: last?.uom || EMPTY_ACCESSORY_LINE.uom,
      };
      return { ...p, lines: [...p.lines, line] };
    });
  };
  const setLine = (i: number, patch: Partial<AccessoryLine>) =>
    setF((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const removeLine = (i: number) => {
    setF((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }));
    // Re-index the custom-type flags around the removed line.
    setCustomLines((prev) => {
      const next = new Set<number>();
      prev.forEach((idx) => { if (idx < i) next.add(idx); else if (idx > i) next.add(idx - 1); });
      return next;
    });
  };
  // Pick a product type from the dropdown, or switch a line to custom free text.
  const onTypeSelect = (i: number, value: string) => {
    if (value === "__custom__") {
      setCustomLines((prev) => new Set(prev).add(i));
      setLine(i, { type: "" });
    } else {
      setCustomLines((prev) => { const n = new Set(prev); n.delete(i); return n; });
      setLine(i, { type: value });
    }
  };
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
              {(() => {
                const isCustom = customLines.has(i) || (!!line.type && !ACCESSORY_TYPE_SUGGESTIONS.includes(line.type));
                return (
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    <select
                      className="h-7 flex-1 rounded-md border bg-background px-2 text-xs font-medium"
                      value={isCustom ? "__custom__" : line.type}
                      onChange={(e) => onTypeSelect(i, e.target.value)}
                    >
                      <option value="">Type…</option>
                      {ACCESSORY_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      <option value="__custom__">Custom type…</option>
                    </select>
                    {isCustom && (
                      <Input
                        className="h-7 flex-1 text-xs"
                        value={line.type}
                        placeholder="Type the product — e.g. Linear Bar Grille"
                        onChange={(e) => setLine(i, { type: e.target.value })}
                      />
                    )}
                  </div>
                );
              })()}
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
              <span className="text-[10px] text-muted-foreground">Dimensions — two required (e.g. &ldquo;450 mm&rdquo; x &ldquo;450 mm&rdquo;)</span>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((di) => {
                  const d = line.dimensions[di] ?? { value: "", label: "" };
                  return (
                    <Input key={di} className="h-7 text-xs" value={d.value} placeholder="450 mm" onChange={(e) => setDim(i, di, { value: e.target.value })} />
                  );
                })}
              </div>
            </div>

            <label className="block space-y-0.5">
              <span className="text-[10px] text-muted-foreground">Note / Remarks</span>
              <textarea
                className="min-h-[38px] w-full rounded-md border bg-background px-2 py-1 text-xs"
                value={line.note}
                onChange={(e) => setLine(i, { note: e.target.value })}
                placeholder="e.g. remarks for this product…"
              />
            </label>

            <p className="text-[11px] text-muted-foreground">{formatAccessoryLine(line)}</p>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addLine}>
          <Plus className="mr-1 h-3 w-3" /> Add product
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">Each product&apos;s note is printed on the job order and shown on the order for conversation &amp; remarks.</p>

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
