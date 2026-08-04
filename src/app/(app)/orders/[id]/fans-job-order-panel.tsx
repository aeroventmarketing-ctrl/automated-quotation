"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil, Plus, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatJoNumber, EMPTY_FANS_JO, joTypeLabel, type FansJobOrder } from "@/lib/job-order";
import { saveFansJobOrder, deleteFansJobOrder } from "../actions";
import { JobOrderApproval } from "./jo-approval";
import { JoNumberEditor } from "./jo-number-editor";
import { JobOrderForm, JoTypeChooser, joToday } from "@/components/fans-job-order-form";

export function FansJobOrderPanel({
  orderId,
  jobOrders,
  baseNo,
  baseYear,
  canManage,
  canAdd = canManage,
  admin = false,
}: {
  orderId: string;
  jobOrders: FansJobOrder[];
  baseNo?: number;
  baseYear?: number;
  canManage: boolean;
  /** Whether new job orders can still be added (hidden once in production). */
  canAdd?: boolean;
  /** Admins can edit the JO numbering (base sequence + year). */
  admin?: boolean;
}) {
  const router = useRouter();
  const [editIndex, setEditIndex] = useState<number | null>(null); // null = list view; -1 = new
  const [newType, setNewType] = useState<string | null>(null); // type chosen for a new JO
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const year = baseYear ?? new Date().getFullYear();
  const total = jobOrders.length;
  const numberFor = (i: number) => (baseNo != null ? formatJoNumber(baseNo, year, i, total) : "—");

  // New JO: first pick the type, then fill its form.
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
        onSave={(jo) => saveFansJobOrder(orderId, editing ? editIndex : null, jo)}
        onDone={() => { setEditIndex(null); setNewType(null); router.refresh(); }}
        onCancel={() => { setEditIndex(null); setNewType(null); }}
      />
    );
  }

  async function remove(i: number) {
    if (!confirm("Delete this job order?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteFansJobOrder(orderId, i);
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
        <p className="text-xs text-muted-foreground">No Fans &amp; Blowers job order yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobOrders.map((jo, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs">
              <span className="font-mono font-semibold">{numberFor(i)}</span>
              {admin && i === 0 && <JoNumberEditor orderId={orderId} dept="fans" baseNo={baseNo} baseYear={baseYear} />}
              <span className="rounded-full bg-[#ED1C24]/10 px-2 py-0.5 font-medium text-[#ED1C24]">{joTypeLabel(jo.type)}</span>
              <span className="text-muted-foreground">
                {[jo.bladeDiameter && `${jo.bladeDiameter}"Ø`, jo.project, jo.quantity && `${jo.quantity} ${jo.uom}`, jo.targetDate && `due ${jo.targetDate}`].filter(Boolean).join(" · ")}
              </span>
              <a
                href={`/orders/${orderId}/jo/${i}/xlsx?view=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-semibold text-muted-foreground hover:bg-muted"
              >
                <Eye className="h-3.5 w-3.5" /> View
              </a>
              <a
                href={`/orders/${orderId}/jo/${i}/xlsx`}
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
              <span className="basis-full" />
              <JobOrderApproval orderId={orderId} dept="fans" index={i} approvedByName={jo.approvedByName} canApprove={canManage} />
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setEditIndex(-1); setNewType(null); }}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Fans &amp; Blowers job order
        </Button>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
