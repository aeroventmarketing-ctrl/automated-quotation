"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApproverHighlight } from "@/components/approver-highlight";
import { raiseMaterialRequest, processMaterialRequest, cancelMaterialRequest, advancePurchaseRequest, confirmMaterialReceipt, followUpMaterialRequest, informMaterialAvailable, releaseMaterialToRequestor, setMrfReleasedQuantities, resetMaterialReceipt } from "../actions";
import type { MRFItem } from "@/lib/order-workflow";
import type { StockOpt } from "./stock-match-panel";
import { MrfTriagePanel } from "./mrf-triage-panel";
import { StockMatchPanel } from "./stock-match-panel";
import { ProductScanBox, ADD_JUMP_MODES } from "@/components/product-scan-box";
import type { ScanProduct } from "@/lib/product-scan";

interface ReqRow {
  id: string;
  formNo: string;
  orderId: string;
  deptLabel: string;
  items: MRFItem[];
  note?: string | null;
  status: "requested" | "issued" | "purchasing" | "partial" | "completed" | "cancelled";
  poStatus?: string | null;
  poStatusLabel?: string | null;
  poStatusVariant?: "secondary" | "warning" | "success" | "destructive" | null;
  hasPo?: boolean;
  poApproved?: boolean;
  linkedPrId?: string | null;
  canApproveMaterials?: boolean;
  // Who must act next on the linked purchase request ("Role (Name)") — for the
  // flashing "awaiting" badge that mirrors the Phase 4 purchasing chain.
  awaitingLabel?: string | null;
  raisedByName: string;
  date: string;
  handledByName?: string;
  handledWhen?: string;
  canHandle: boolean;
  canCancel: boolean;
  // Fulfillment handshake.
  receivedByName?: string | null;
  isDeptHead?: boolean;
  canInform?: boolean;
  canRelease?: boolean;
  releasedByName?: string | null;
  confirmedByName?: string | null;
  confirmedWhen?: string | null;
  informedByName?: string | null;
  informedWhen?: string | null;
  followUpCount?: number;
  lastFollowUpWhen?: string | null;
}

const STATUS: Record<ReqRow["status"], { label: string; variant: "secondary" | "success" | "warning" | "destructive" }> = {
  requested: { label: "Requested", variant: "secondary" },
  issued: { label: "Issued from stock", variant: "success" },
  purchasing: { label: "For purchasing", variant: "warning" },
  partial: { label: "Partly issued · purchasing", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

const emptyRow = (): MRFItem => ({ description: "", qty: "", unit: "", remark: "" });

/** Standard units offered in the MRF unit dropdown. */
const UNIT_OPTIONS = ["pc", "pcs", "length", "set"];
/** Units are lower-case only: match a standard option, else lower-case the value. */
const normalizeUnit = (u: string | undefined): string => {
  const t = (u ?? "").trim();
  return UNIT_OPTIONS.find((o) => o.toLowerCase() === t.toLowerCase()) ?? t.toLowerCase();
};

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
  showMrfDoc = true,
  admin = false,
}: {
  orderId: string;
  requesterName: string;
  raisableDepts: { key: string; label: string }[];
  requests: ReqRow[];
  stockItems: StockOpt[];
  products?: ScanProduct[];
  /** Whether to show the MRF View / Print document links. */
  showMrfDoc?: boolean;
  /** Admin — may correct the recorded released quantities. */
  admin?: boolean;
}) {
  const router = useRouter();
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctQty, setCorrectQty] = useState<Record<string, string>>({});
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
          return { ...r, description: value, unit: normalizeUnit(r.unit || match?.unit || "") };
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
      setRows((rs) => [...rs, { description: product.name, qty: String(qty), unit: normalizeUnit(product.unit), remark: "" }]);
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
                    <td className="py-1 px-1">
                      <select value={normalizeUnit(r.unit)} onChange={(e) => setCell(i, "unit", e.target.value)} className="w-full rounded border bg-background px-1 py-1">
                        <option value="">—</option>
                        {/* Keep any non-standard unit (already lower-cased) so it isn't lost. */}
                        {[...UNIT_OPTIONS, ...(normalizeUnit(r.unit) && !UNIT_OPTIONS.includes(normalizeUnit(r.unit)) ? [normalizeUnit(r.unit)] : [])].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </td>
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
                  {/* Awaiting the Plant Manager's approval — the amber "For
                      purchasing" only appears once they approve (step 16). */}
                  {/* Badge mirrors the purchasing chain so the order and Purchasing
                      stay in sync: pending → Plant Manager approval, then the live
                      purchase-chain status (approved → PO → voucher → … → completed). */}
                  {r.poStatus === "PENDING_APPROVAL" ? (
                    <Badge variant="secondary">Awaiting Plant Manager approval</Badge>
                  ) : r.poStatus === "REJECTED" ? (
                    <Badge variant="destructive">Materials request rejected</Badge>
                  ) : r.poStatus && r.poStatusLabel ? (
                    <Badge variant={r.poStatusVariant ?? "warning"}>
                      {r.poStatus === "APPROVED" && !r.hasPo
                        ? "Approved — awaiting Purchase Order"
                        : r.poStatus === "APPROVED" && r.hasPo && !r.poApproved
                        ? "Plant Manager approved — awaiting purchase approval"
                        : r.poStatusLabel}
                    </Badge>
                  ) : (
                    <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  )}
                  {showMrfDoc && (
                    <>
                      <Link href={`/orders/${r.orderId}/mrf/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <Eye className="h-3.5 w-3.5" /> View
                      </Link>
                      <Link href={`/orders/${r.orderId}/mrf/${r.id}`} target="_blank" className="text-xs text-primary hover:underline">Print</Link>
                    </>
                  )}
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
                          {it.disposition && (() => {
                            const req = Number(it.qty || 0);
                            const emerald = "bg-emerald-600/15 text-emerald-700";
                            const amber = "bg-amber-500/15 text-amber-700";
                            let cls: string;
                            let text: string;
                            if (it.disposition === "purchase") {
                              // Not released yet → "To purchase"; once released show how much.
                              if (it.issuedQty == null) { cls = amber; text = "To purchase"; }
                              else {
                                const rel = Number(it.issuedQty);
                                const short = rel < req;
                                cls = short ? amber : emerald;
                                text = short ? `Released ${it.issuedQty} of ${it.qty}` : `Released ${it.issuedQty}`;
                              }
                            } else {
                              // Older MRFs stored no issued qty — treat absent as fully issued.
                              const issued = it.issuedQty ?? it.qty;
                              const short = Number(issued || 0) < req;
                              cls = short ? amber : it.disposition === "reserve" ? "bg-indigo-600/15 text-indigo-700" : emerald;
                              text = `${it.disposition === "issue" ? "Issued" : "Reserved"} ${issued || 0}${short ? ` of ${it.qty}` : ""}`;
                            }
                            return <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{text}</span>;
                          })()}
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
              {/* Fulfillment handshake: the Warehouse informs availability; the
                  requesting department confirms receipt of released materials;
                  the department can follow up while the MRF is outstanding. */}
              {r.status !== "cancelled" && (r.isDeptHead || r.canInform || r.canRelease || r.informedByName || r.releasedByName || r.confirmedByName) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                  {r.informedByName && <Badge variant="secondary">Available — informed by {r.informedByName}</Badge>}
                  {r.releasedByName && <Badge variant="secondary">Released by {r.releasedByName}</Badge>}
                  {/* Warehouse / Purchaser / Payment Approver / admin release the
                      purchased (now in-stock) materials to the requesting department,
                      deducting the released quantity from inventory. */}
                  {r.canRelease && r.items.some((it) => it.disposition === "purchase" && Number(it.issuedQty ?? 0) < Number(it.qty || 0)) && releasingId !== r.id && (
                    <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => setReleasingId(r.id)}>{r.releasedByName ? "Release remaining" : "Release to requestor"}</Button>
                  )}
                  {r.confirmedByName ? (
                    <>
                      <Badge variant="success">Received &amp; confirmed by {r.confirmedByName}{r.confirmedWhen ? ` · ${r.confirmedWhen}` : ""}</Badge>
                      {admin && (
                        <button type="button" disabled={busy}
                          className="text-xs font-medium text-muted-foreground hover:text-destructive"
                          onClick={() => { if (window.confirm(`Reset the receipt confirmation on MRF #${r.formNo}? The requesting department will need to confirm receipt itself.`)) run(() => resetMaterialReceipt(orderId, r.id)); }}>
                          Reset receipt (admin)
                        </button>
                      )}
                    </>
                  ) : (r.status === "issued" || r.status === "partial") && r.isDeptHead ? (
                    <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => run(() => confirmMaterialReceipt(orderId, r.id))}>{r.deptLabel} Request Received</Button>
                  ) : null}
                  {r.canInform && !r.informedByName && !r.releasedByName && (r.status === "issued" || r.status === "partial") && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => run(() => informMaterialAvailable(orderId, r.id))}>Inform requestor — available</Button>
                  )}
                  {r.isDeptHead && !r.confirmedByName && (
                    <button type="button" disabled={busy} className="text-xs font-medium text-primary hover:underline" onClick={() => run(() => followUpMaterialRequest(orderId, r.id))}>Follow up</button>
                  )}
                  {r.followUpCount ? <span className="text-xs text-muted-foreground">Followed up {r.followUpCount}×{r.lastFollowUpWhen ? ` · ${r.lastFollowUpWhen}` : ""}</span> : null}
                </div>
              )}
              {/* Release picker: match each purchased line to the stock item to
                  deduct as it's handed to the requesting department. */}
              {r.canRelease && releasingId === r.id && (() => {
                // Only lines with an unreleased balance; default to the remaining qty.
                const releasable = r.items.filter((it) => it.disposition === "purchase" && Number(it.issuedQty ?? 0) < Number(it.qty || 0));
                return (
                  <StockMatchPanel
                    lines={releasable.map((it) => {
                      const remaining = Number(it.qty || 0) - Number(it.issuedQty ?? 0);
                      return { label: `${[String(remaining), it.unit].filter(Boolean).join(" ")} · ${it.description}`, qtyDefault: String(remaining) };
                    })}
                    stockItems={stockItems}
                    selectable
                    submitLabel="Release & deduct from stock"
                    onCancel={() => setReleasingId(null)}
                    onSubmit={async (matches) => {
                      const released = matches
                        .map((m) => ({ description: releasable[m.lineIndex]?.description ?? "", qty: m.qty }))
                        .filter((x) => x.description);
                      await releaseMaterialToRequestor(orderId, r.id, matches, released);
                      setReleasingId(null);
                      router.refresh();
                    }}
                  />
                );
              })()}
              {/* Admin correction of the recorded released quantities (fixes the
                  card/status without double-counting; does not change inventory). */}
              {admin && r.items.some((it) => it.disposition === "purchase") && (
                correctingId === r.id ? (
                  <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
                    <div className="text-xs font-medium">Correct released quantities (admin)</div>
                    <p className="text-[11px] text-muted-foreground">Set the exact quantity released for each purchased item. This fixes the record &amp; status only — it does not change inventory (adjust stock in Inventory if needed).</p>
                    {r.items.filter((it) => it.disposition === "purchase").map((it, k) => {
                      const key = `${r.id}:${it.description}`;
                      return (
                        <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-[10rem] flex-1">{it.description} <span className="text-muted-foreground">(of {it.qty} {it.unit})</span></span>
                          <input type="number" min={0} step="any" placeholder="Released"
                            className="h-8 w-24 rounded-md border bg-background px-2 text-right text-sm"
                            value={correctQty[key] ?? it.issuedQty ?? ""}
                            onChange={(e) => setCorrectQty((q) => ({ ...q, [key]: e.target.value }))} />
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="h-7 text-xs" disabled={busy}
                        onClick={() => run(
                          () => setMrfReleasedQuantities(orderId, r.id, r.items.filter((it) => it.disposition === "purchase").map((it) => ({ description: it.description, qty: Number(correctQty[`${r.id}:${it.description}`] ?? it.issuedQty ?? 0) || 0 }))),
                          () => setCorrectingId(null),
                        )}>
                        Save corrections
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => setCorrectingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="mt-2 text-xs font-medium text-muted-foreground hover:text-primary" onClick={() => setCorrectingId(r.id)}>Correct released qty (admin)</button>
                )
              )}
              {/* Flashing "awaiting approval" badge naming the designation + person
                  who must act next on the linked purchase request — same behaviour
                  as the Phase 4 purchasing chain, shown to every role. */}
              {r.awaitingLabel && (
                <div className="mt-2"><ApproverHighlight role={r.awaitingLabel} /></div>
              )}
              {/* Plant Manager approval (step 16): once the warehouse escalates a
                  request for purchasing, the Plant Manager approves it here before
                  it becomes "For purchasing" and the Purchaser prepares the PO. */}
              {r.canApproveMaterials && r.linkedPrId && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" className="h-7 text-xs" disabled={busy}
                    onClick={() => run(() => advancePurchaseRequest(r.linkedPrId!, "approve"))}>
                    Approve Material Request
                  </Button>
                  <button type="button" disabled={busy}
                    className="text-xs font-medium text-muted-foreground hover:text-destructive"
                    onClick={() => { if (window.confirm(`Reject materials request MRF #${r.formNo}?`)) run(() => advancePurchaseRequest(r.linkedPrId!, "reject")); }}>
                    Reject
                  </button>
                </div>
              )}
              {r.status === "requested" && (r.canHandle || r.canCancel) && issuingId !== r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* Warehouse checks availability first, then either issues from
                      stock (available) or sends the shortfall to purchasing. */}
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
