"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { raiseMaterialRequest, handleMaterialRequest } from "../actions";
import type { MRFItem } from "@/lib/order-workflow";

interface ReqRow {
  id: string;
  formNo: string;
  orderId: string;
  deptLabel: string;
  items: MRFItem[];
  note?: string | null;
  status: "requested" | "issued" | "purchasing";
  raisedByName: string;
  date: string;
  handledByName?: string;
  canHandle: boolean;
}

const STATUS: Record<ReqRow["status"], { label: string; variant: "secondary" | "success" | "warning" }> = {
  requested: { label: "Requested", variant: "secondary" },
  issued: { label: "Issued from stock", variant: "success" },
  purchasing: { label: "For purchasing", variant: "warning" },
};

const emptyRow = (): MRFItem => ({ description: "", qty: "", unit: "", remark: "" });

export function MaterialRequests({
  orderId,
  requesterName,
  raisableDepts,
  requests,
}: {
  orderId: string;
  requesterName: string;
  raisableDepts: { key: string; label: string }[];
  requests: ReqRow[];
}) {
  const router = useRouter();
  const [dept, setDept] = useState(raisableDepts[0]?.key ?? "");
  const [rows, setRows] = useState<MRFItem[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setCell(i: number, key: keyof MRFItem, value: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  async function run(fn: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const hasItems = rows.some((r) => r.description.trim() !== "");

  return (
    <div className="space-y-4">
      {raisableDepts.length > 0 && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Material Request Form</div>
            <div className="text-xs text-muted-foreground">Requested by <b>{requesterName}</b> · {new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</div>
          </div>

          {raisableDepts.length > 1 ? (
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              {raisableDepts.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          ) : (
            <div className="text-sm text-muted-foreground">{raisableDepts[0].label}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Articles / Description</th>
                  <th className="w-16 py-1 px-1 font-medium">Qty</th>
                  <th className="w-20 py-1 px-1 font-medium">Unit</th>
                  <th className="w-32 py-1 pl-1 font-medium">Remark</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2"><input value={r.description} onChange={(e) => setCell(i, "description", e.target.value)} className="w-full rounded border bg-background px-2 py-1" /></td>
                    <td className="py-1 px-1"><input value={r.qty} onChange={(e) => setCell(i, "qty", e.target.value)} className="w-full rounded border bg-background px-1 py-1 text-right" /></td>
                    <td className="py-1 px-1"><input value={r.unit} onChange={(e) => setCell(i, "unit", e.target.value)} className="w-full rounded border bg-background px-1 py-1" /></td>
                    <td className="py-1 pl-1"><input value={r.remark ?? ""} onChange={(e) => setCell(i, "remark", e.target.value)} className="w-full rounded border bg-background px-1 py-1" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRows((rs) => [...rs, emptyRow()])}>+ Add row</Button>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 flex-1 min-w-[10rem] rounded-md border bg-background px-2 text-sm" />
          </div>
          <Button size="sm" disabled={busy || !dept || !hasItems}
            onClick={() => run(() => raiseMaterialRequest(orderId, dept, rows, note), () => { setRows([emptyRow(), emptyRow(), emptyRow()]); setNote(""); })}>
            {busy ? "Saving…" : "Submit request"}
          </Button>
        </div>
      )}

      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No material requests yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="rounded-md border p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  MRF #{r.formNo} · {r.deptLabel}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  <Link href={`/orders/${r.orderId}/mrf/${r.id}`} target="_blank" className="text-xs text-primary hover:underline">Print</Link>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Articles / Description</th>
                      <th className="py-1 px-2 font-medium">Qty</th>
                      <th className="py-1 px-2 font-medium">Unit</th>
                      <th className="py-1 pl-2 font-medium">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((it, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1 pr-2">{it.description}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{it.qty}</td>
                        <td className="py-1 px-2">{it.unit}</td>
                        <td className="py-1 pl-2 text-muted-foreground">{it.remark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                Requested by {r.raisedByName} · {r.date}{r.handledByName ? ` · handled by ${r.handledByName}` : ""}
              </p>
              {r.status === "requested" && r.canHandle && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => run(() => handleMaterialRequest(orderId, r.id, "issue"))}>Issue from stock</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => run(() => handleMaterialRequest(orderId, r.id, "purchase"))}>Request purchase</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
