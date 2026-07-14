"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { raiseMaterialRequest, handleMaterialRequest } from "../actions";

interface ReqRow {
  id: string;
  dept: string;
  deptLabel: string;
  items: string[];
  note?: string;
  status: "requested" | "issued" | "purchasing";
  raisedByName: string;
  handledByName?: string;
  canHandle: boolean;
}

const STATUS: Record<ReqRow["status"], { label: string; variant: "secondary" | "success" | "warning" }> = {
  requested: { label: "Requested", variant: "secondary" },
  issued: { label: "Issued from stock", variant: "success" },
  purchasing: { label: "For purchasing", variant: "warning" },
};

export function MaterialRequests({
  orderId,
  raisableDepts,
  requests,
}: {
  orderId: string;
  raisableDepts: { key: string; label: string }[];
  requests: ReqRow[];
}) {
  const router = useRouter();
  const [dept, setDept] = useState(raisableDepts[0]?.key ?? "");
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      {raisableDepts.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-medium">Raise a material request</div>
          <div className="flex flex-wrap gap-2">
            {raisableDepts.length > 1 && (
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {raisableDepts.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            )}
            {raisableDepts.length === 1 && (
              <span className="flex h-9 items-center text-sm text-muted-foreground">{raisableDepts[0].label}</span>
            )}
          </div>
          <textarea
            value={items}
            onChange={(e) => setItems(e.target.value)}
            placeholder="One material per line, e.g.&#10;GI sheet 24ga x 4&#10;Angle bar 1&quot; x 2"
            rows={3}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <Button
            size="sm"
            disabled={busy || !dept || items.trim() === ""}
            onClick={() =>
              run(
                () => raiseMaterialRequest(orderId, dept, items.split("\n"), note),
                () => { setItems(""); setNote(""); },
              )
            }
          >
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
                <span className="text-sm font-medium">{r.deptLabel}</span>
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
              </div>
              <ul className="ml-4 list-disc text-sm text-muted-foreground">
                {r.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
              {r.note && <p className="mt-1 text-xs text-muted-foreground">Note: {r.note}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                Raised by {r.raisedByName}
                {r.handledByName ? ` · handled by ${r.handledByName}` : ""}
              </p>
              {r.status === "requested" && r.canHandle && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
                    onClick={() => run(() => handleMaterialRequest(orderId, r.id, "issue"))}>
                    Issue from stock
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
                    onClick={() => run(() => handleMaterialRequest(orderId, r.id, "purchase"))}>
                    Request purchase
                  </Button>
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
