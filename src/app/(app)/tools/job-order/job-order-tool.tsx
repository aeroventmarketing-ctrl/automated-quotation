"use client";

import { useState } from "react";
import { Printer, Plus, Trash2, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMPTY_FANS_JO, joTypeLabel, type FansJobOrder } from "@/lib/job-order";
import { JobOrderForm, JoTypeChooser, joToday } from "@/components/fans-job-order-form";

/** Base64-encode a job order (UTF-8 safe) for the standalone print route. */
function encodeJo(jo: FansJobOrder): string {
  const bytes = new TextEncoder().encode(JSON.stringify(jo));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return encodeURIComponent(btoa(bin));
}

/**
 * Standalone Fans & Blowers job-order builder for the HVAC Tools tab. It offers
 * the exact same create/edit form as the order's Phase-2 panel, but the job
 * orders live only in this page — each can be printed / previewed on its own,
 * with a free-text JO number (there's no order to derive one from).
 */
export function JobOrderTool() {
  const [jobOrders, setJobOrders] = useState<FansJobOrder[]>([]);
  const [editIndex, setEditIndex] = useState<number | null>(null); // null = list; -1 = new
  const [newType, setNewType] = useState<string | null>(null);

  // New JO: pick the type first, then fill the form.
  if (editIndex === -1 && newType === null) {
    return <JoTypeChooser onPick={(key) => setNewType(key)} onCancel={() => setEditIndex(null)} />;
  }
  if (editIndex !== null) {
    const editing = editIndex >= 0;
    const initial = editing
      ? jobOrders[editIndex]
      : { ...EMPTY_FANS_JO, type: newType ?? EMPTY_FANS_JO.type, date: joToday() };
    return (
      <JobOrderForm
        isEdit={editing}
        initial={initial}
        onSave={(jo) => {
          setJobOrders((list) => {
            if (editing) return list.map((x, i) => (i === editIndex ? jo : x));
            return [...list, jo];
          });
        }}
        onDone={() => { setEditIndex(null); setNewType(null); }}
        onCancel={() => { setEditIndex(null); setNewType(null); }}
      />
    );
  }

  const setNumber = (i: number, v: string) =>
    setJobOrders((list) => list.map((x, k) => (k === i ? { ...x, joNumber: v } : x)));
  const remove = (i: number) => {
    if (!confirm("Delete this job order?")) return;
    setJobOrders((list) => list.filter((_, k) => k !== i));
  };

  return (
    <div className="space-y-3">
      {jobOrders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No job order yet. Add a Fans &amp; Blowers job order to build and print one.</p>
      ) : (
        <ul className="space-y-2">
          {jobOrders.map((jo, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs">
              <label className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground">JO No.</span>
                <Input
                  className="h-7 w-40 font-mono text-xs"
                  value={jo.joNumber}
                  placeholder="AFBM-JO…"
                  onChange={(e) => setNumber(i, e.target.value)}
                />
              </label>
              <span className="rounded-full bg-[#ED1C24]/10 px-2 py-0.5 font-medium text-[#ED1C24]">{joTypeLabel(jo.type)}</span>
              <span className="text-muted-foreground">
                {[jo.bladeDiameter && `${jo.bladeDiameter}"Ø`, jo.project, jo.quantity && `${jo.quantity} ${jo.uom}`, jo.targetDate && `due ${jo.targetDate}`].filter(Boolean).join(" · ")}
              </span>
              <a
                href={`/tools/job-order/xlsx?data=${encodeJo(jo)}&view=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-semibold text-muted-foreground hover:bg-muted"
              >
                <Eye className="h-3.5 w-3.5" /> View
              </a>
              <a
                href={`/tools/job-order/xlsx?data=${encodeJo(jo)}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a]"
              >
                <Printer className="h-3.5 w-3.5" /> Print Job Order
              </a>
              <button type="button" onClick={() => setEditIndex(i)} className="inline-flex items-center gap-1 rounded-md border border-[#ED1C24] px-2 py-1.5 font-semibold text-[#ED1C24] hover:bg-[#ED1C24]/10">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button type="button" onClick={() => remove(i)} className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditIndex(-1); setNewType(null); }}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add Fans &amp; Blowers job order
      </Button>
    </div>
  );
}
