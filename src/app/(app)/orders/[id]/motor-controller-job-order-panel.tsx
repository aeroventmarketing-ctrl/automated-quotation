"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EMPTY_MOTOR_CONTROLLER_JO,
  EMPTY_MOTOR_CONTROLLER_LINE,
  formatMotorControllerJoNumber,
  formatMotorControllerLine,
  STARTER_TYPES,
  MC_PHASES,
  MC_UOMS,
  type MotorControllerJobOrder,
  type MotorControllerLine,
} from "@/lib/motor-controller-job-order";
import { saveMotorControllerJobOrder, deleteMotorControllerJobOrder } from "../actions";
import { JobOrderApproval } from "./jo-approval";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function MotorControllerJobOrderPanel({
  orderId,
  jobOrders,
  baseNo,
  baseYear,
  canManage,
  canAdd = canManage,
}: {
  orderId: string;
  jobOrders: MotorControllerJobOrder[];
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
  const numberFor = (i: number) => (baseNo != null ? formatMotorControllerJoNumber(baseNo, year, i, total) : "—");

  if (editIndex !== null) {
    const editing = editIndex >= 0;
    const initial = editing ? jobOrders[editIndex] : { ...EMPTY_MOTOR_CONTROLLER_JO, date: todayISO() };
    return (
      <MotorControllerJobOrderForm
        orderId={orderId}
        index={editing ? editIndex : null}
        initial={initial}
        onDone={() => { setEditIndex(null); router.refresh(); }}
        onCancel={() => setEditIndex(null)}
      />
    );
  }

  async function remove(i: number) {
    if (!confirm("Delete this motor controller job order?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteMotorControllerJobOrder(orderId, i);
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
        <p className="text-xs text-muted-foreground">No motor controller job order yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobOrders.map((jo, i) => (
            <li key={i} className="space-y-1 rounded-md border bg-muted/20 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{numberFor(i)}</span>
                <span className="rounded-full bg-[#ED1C24]/10 px-2 py-0.5 font-medium text-[#ED1C24]">Motor Controller</span>
                <span className="text-muted-foreground">
                  {[jo.project, jo.lines.length ? `${jo.lines.length} unit${jo.lines.length > 1 ? "s" : ""}` : null, jo.dueDate && `due ${jo.dueDate}`].filter(Boolean).join(" · ")}
                </span>
                <a
                  href={`/orders/${orderId}/jo-mc/${i}/xlsx?view=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-semibold text-muted-foreground hover:bg-muted"
                >
                  <Eye className="h-3.5 w-3.5" /> View
                </a>
                <a
                  href={`/orders/${orderId}/jo-mc/${i}/xlsx`}
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
              <JobOrderApproval orderId={orderId} dept="motor" index={i} approvedByName={jo.approvedByName} canApprove={canManage} />
              {jo.note && <p className="text-[11px] text-muted-foreground"><span className="font-medium">Note:</span> {jo.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditIndex(-1)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add motor controller job order
        </Button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function MotorControllerJobOrderForm({
  orderId,
  index,
  initial,
  onDone,
  onCancel,
}: {
  orderId: string;
  index: number | null;
  initial: MotorControllerJobOrder;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<MotorControllerJobOrder>({ ...initial, lines: initial.lines.length ? initial.lines : [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof MotorControllerJobOrder, v: string) => setF((p) => ({ ...p, [k]: v }));

  const addLine = () => {
    setF((p) => {
      const last = p.lines[p.lines.length - 1];
      const line: MotorControllerLine = {
        ...EMPTY_MOTOR_CONTROLLER_LINE,
        uom: last?.uom || EMPTY_MOTOR_CONTROLLER_LINE.uom,
        phase: last?.phase || EMPTY_MOTOR_CONTROLLER_LINE.phase,
        voltage: last?.voltage || EMPTY_MOTOR_CONTROLLER_LINE.voltage,
      };
      return { ...p, lines: [...p.lines, line] };
    });
  };
  const setLine = (i: number, patch: Partial<MotorControllerLine>) =>
    setF((p) => ({ ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const removeLine = (i: number) => setF((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveMotorControllerJobOrder(orderId, index, f);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">{index != null ? "Edit" : "New"} Motor Controller Job Order</div>

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

      <div className="text-xs font-semibold text-muted-foreground">Motor controllers</div>
      <div className="space-y-2">
        {f.lines.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No motor controllers yet — click &ldquo;Add motor controller&rdquo; below.</p>
        )}
        {f.lines.map((line, i) => (
          <div key={i} className="space-y-2 rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground">{i + 1}.</span>
              <select
                className="h-7 flex-1 rounded-md border bg-background px-2 text-xs font-medium"
                value={line.starterType}
                onChange={(e) => setLine(i, { starterType: e.target.value })}
              >
                <option value="">Starter type…</option>
                {STARTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                {line.starterType && !STARTER_TYPES.includes(line.starterType) && <option value={line.starterType}>{line.starterType}</option>}
              </select>
              <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Qty</span>
                <Input className="h-7 text-xs" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputMode="numeric" />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">UOM</span>
                <select className="h-7 w-full rounded-md border bg-background px-1 text-xs" value={line.uom} onChange={(e) => setLine(i, { uom: e.target.value })}>
                  {MC_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">HP</span>
                <Input className="h-7 text-xs" value={line.hp} placeholder="5" onChange={(e) => setLine(i, { hp: e.target.value })} inputMode="decimal" />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Phase</span>
                <select className="h-7 w-full rounded-md border bg-background px-1 text-xs" value={line.phase} onChange={(e) => setLine(i, { phase: e.target.value })}>
                  {MC_PHASES.map((ph) => <option key={ph} value={ph}>{ph} Ph</option>)}
                </select>
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Voltage (v)</span>
                <Input className="h-7 text-xs" value={line.voltage} placeholder="400" onChange={(e) => setLine(i, { voltage: e.target.value })} inputMode="numeric" />
              </label>
            </div>

            <p className="text-[11px] text-muted-foreground">{formatMotorControllerLine(line)}</p>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addLine}>
          <Plus className="mr-1 h-3 w-3" /> Add motor controller
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
