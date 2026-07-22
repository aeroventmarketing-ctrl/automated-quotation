"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { raiseMaterialRequest, processMaterialRequest, cancelMaterialRequest } from "../actions";
import type { MRFItem } from "@/lib/order-workflow";
import type { StockOpt } from "./stock-match-panel";
import { MrfTriagePanel } from "./mrf-triage-panel";
import { ProductScanBox, ADD_JUMP_MODES } from "@/components/product-scan-box";
import type { ScanProduct } from "@/lib/product-scan";

interface ReqRow {
  id: string;
  formNo: string;
  orderId: string;
  deptLabel: string;
  items: MRFItem[];
  note?: string | null;
  status: "requested" | "issued" | "purchasing" | "partial" | "cancelled";
  poStatusLabel?: string | null;
  poStatusVariant?: "secondary" | "warning" | "success" | "destructive" | null;
  raisedByName: string;
  date: string;
  handledByName?: string;
  handledWhen?: string;
  canHandle: boolean;
  canCancel: boolean;
}

const STATUS: Record<ReqRow["status"], { label: string; variant: "secondary" | "success" | "warning" | "destructive" }> = {
  requested: { label: "Requested", variant: "secondary" },
  issued: { label: "Issued from stock", variant: "success" },
  purchasing: { label: "For purchasing", variant: "warning" },
  partial: { label: "Partly issued · purchasing", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

const emptyRow = (): MRFItem => ({ description: "", qty: "", unit: "", remark: "" });

/**
 * Product autocomplete for the description field. Unlike a native <datalist>, it
 * keeps showing matches even when the value already equals a product (no need to
 * clear the field), and uses fixed positioning so the table's horizontal scroll
 * never clips it.
 */
function ProductCombobox({ value, onChange, products }: { value: string; onChange: (v: string) => void; products: { name: string; unit: string }[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const q = value.trim().toLowerCase();
  const matches = (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(0, 10);

  function place() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom, width: r.width });
  }

  return (
    <>
      <input
        ref={ref}
        value={value}
        onChange={(e) => { onChange(e.target.value); place(); setOpen(true); }}
        onFocus={() => { place(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Type or pick a product"
        className="w-full rounded border bg-background px-2 py-1"
      />
      {open && pos && products.length > 0 && matches.length > 0 && (
        <ul
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 50 }}
          className="mt-1 max-h-52 overflow-auto rounded-md border bg-background text-sm shadow-md"
        >
          {matches.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(p.name); setOpen(false); }}
                className="block w-full px-2 py-1.5 text-left hover:bg-accent"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function MaterialRequests({
  orderId,
  requesterName,
  raisableDepts,
  requests,
  stockItems,
  products = [],
}: {
  orderId: string;
  requesterName: string;
  raisableDepts: { key: string; label: string }[];
  requests: ReqRow[];
  stockItems: StockOpt[];
  products?: ScanProduct[];
}) {
  const router = useRouter();
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [dept, setDept] = useState(raisableDepts[0]?.key ?? "");
  const [rows, setRows] = useState<MRFItem[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const productByName = useMemo(() => new Map(products.map((p) => [p.name.trim().toLowerCase(), p])), [products]);

  function setCell(i: number, key: keyof MRFItem, value: string) {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        // Picking/typing a catalogued product auto-fills its unit when blank.
        if (key === "description") {
          const match = productByName.get(value.trim().toLowerCase());
          return { ...r, description: value, unit: r.unit || match?.unit || "" };
        }
        return { ...r, [key]: value };
      }),
    );
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
  const [highlight, setHighlight] = useState<number | null>(null);
  function flash(idx: number) {
    setHighlight(idx);
    setTimeout(() => setHighlight((h) => (h === idx ? null : h)), 2000);
  }
  function handleScan({ mode, product, qty }: { mode: string; product: ScanProduct; qty: number }) {
    if (mode === "add") {
      setRows((rs) => [...rs, { description: product.name, qty: String(qty), unit: product.unit, remark: "" }]);
      return { ok: true, message: `Added ${qty} · ${product.name}` };
    }
    const idx = rows.findIndex((r) => r.description.trim().toLowerCase() === product.name.trim().toLowerCase());
    if (idx >= 0) { flash(idx); return { ok: true, message: `In row ${idx + 1}: ${product.name}` }; }
    return { ok: false, message: `${product.name} isn't in the list yet.` };
  }

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

          {products.length > 0 && <ProductScanBox products={products} modes={ADD_JUMP_MODES("add item")} onScan={handleScan} className="rounded-md border bg-muted/20 p-2" />}

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
                  <tr key={i} className={`border-b last:border-0 transition-colors ${highlight === i ? "bg-amber-200/60" : ""}`}>
                    <td className="py-1 pr-2"><ProductCombobox value={r.description} onChange={(v) => setCell(i, "description", v)} products={products} /></td>
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
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  {r.poStatusLabel && r.poStatusVariant && (
                    <Badge variant={r.poStatusVariant}>PO: {r.poStatusLabel}</Badge>
                  )}
                  <Link href={`/orders/${r.orderId}/mrf/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Eye className="h-3.5 w-3.5" /> View
                  </Link>
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
                        <td className="py-1 pr-2">
                          {it.description}
                          {it.disposition && (
                            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${it.disposition === "issue" ? "bg-emerald-600/15 text-emerald-700" : it.disposition === "reserve" ? "bg-indigo-600/15 text-indigo-700" : "bg-amber-500/15 text-amber-700"}`}>
                              {it.disposition === "issue" ? "Issued" : it.disposition === "reserve" ? "Reserved" : "To purchase"}
                            </span>
                          )}
                        </td>
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
                Requested by {r.raisedByName} · {r.date}
                {r.handledByName ? ` · handled by ${r.handledByName}${r.handledWhen ? ` · ${r.handledWhen}` : ""}` : ""}
              </p>
              {r.status === "requested" && (r.canHandle || r.canCancel) && issuingId !== r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {r.canHandle && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setIssuingId(r.id)}>Check availability &amp; process</Button>
                  )}
                  {r.canCancel && (
                    <button type="button" disabled={busy}
                      className="text-xs font-medium text-muted-foreground hover:text-destructive"
                      onClick={() => { if (window.confirm(`Cancel material request MRF #${r.formNo}?`)) run(() => cancelMaterialRequest(orderId, r.id)); }}>
                      Cancel request
                    </button>
                  )}
                </div>
              )}
              {r.status === "requested" && r.canHandle && issuingId === r.id && (
                <MrfTriagePanel
                  lines={r.items.map((it) => ({ description: it.description, qty: it.qty, unit: it.unit, remark: it.remark }))}
                  stockItems={stockItems}
                  onCancel={() => setIssuingId(null)}
                  onSubmit={async (dispositions) => {
                    await processMaterialRequest(orderId, r.id, dispositions);
                    setIssuingId(null);
                    router.refresh();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
