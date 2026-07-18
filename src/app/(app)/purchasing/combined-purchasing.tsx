"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { poLineAmount, poTotals, poLineFromPRItem, type POLine } from "@/lib/purchase-order";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import type { PRStatus } from "@/lib/purchasing";
import { createCombinedPO, advanceCombinedPO, receiveCombinedPO } from "../orders/actions";
import { StockMatchPanel, type StockOpt } from "../orders/[id]/stock-match-panel";

export interface CombinableItem {
  id: string;
  orderId: string;
  orderLabel: string;
  deptLabel: string;
  mrfNo: string | null;
  items: string[];
}
export interface BatchMember {
  orderLabel: string;
  deptLabel: string;
  mrfNo: string | null;
  items: string[];
}
export interface BatchAction {
  key: string;
  label: string;
  canAct: boolean;
  roleLabel: string;
}
export interface BatchCard {
  anchorId: string;
  orderIdForPrint: string;
  poNumber: string;
  supplierCompany: string;
  status: PRStatus;
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  lines: POLine[];
  members: BatchMember[];
  trail: string[];
  actions: BatchAction[];
  canManagePO: boolean;
}

function todayInput(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Combine builder + existing combined-PO cards, both acting on the whole batch. */
export function CombinedPurchasing({
  combinable,
  batches,
  suppliers,
  paymentTerms,
  stockItems,
  canManagePO,
  poDefaultRemarks,
}: {
  combinable: CombinableItem[];
  batches: BatchCard[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  stockItems: StockOpt[];
  canManagePO: boolean;
  poDefaultRemarks: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const selectedItems = combinable.filter((c) => sel.has(c.id));

  return (
    <div className="space-y-3">
      {/* Existing combined POs */}
      {batches.map((b) => <BatchCardView key={b.anchorId} batch={b} stockItems={stockItems} />)}

      {/* Combine builder */}
      {canManagePO && combinable.length > 0 && (
        <div className="rounded-md border p-3">
          {!building ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Combine requests into one PO</div>
                <Button size="sm" disabled={sel.size < 2} onClick={() => setBuilding(true)}>
                  Combine {sel.size > 0 ? `${sel.size} ` : ""}into one PO
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Tick the open requests going to the same supplier — across any orders — then issue a single PO for all of them.</p>
              <div className="divide-y rounded-md border">
                {combinable.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 p-2 text-sm hover:bg-accent/40">
                    <input type="checkbox" className="mt-1 accent-[#ED1C24]" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                    <span className="flex-1">
                      <span className="font-medium">{c.deptLabel}</span>
                      {c.mrfNo && <span className="ml-1 text-muted-foreground">MRF #{c.mrfNo}</span>}
                      <span className="ml-1 text-xs text-muted-foreground">· {c.orderLabel}</span>
                      <span className="block text-xs text-muted-foreground">{c.items.join(", ")}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <CombineForm
              items={selectedItems}
              suppliers={suppliers}
              paymentTerms={paymentTerms}
              poDefaultRemarks={poDefaultRemarks}
              onCancel={() => setBuilding(false)}
              onDone={() => { setBuilding(false); setSel(new Set()); router.refresh(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BatchCardView({ batch, stockItems }: { batch: BatchCard; stockItems: StockOpt[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const totals = poTotals({ lines: batch.lines, ewtPct: 0 });
  const actionable = batch.actions.filter((a) => a.canAct);
  const awaiting = batch.actions.find((a) => !a.canAct);

  async function run(stepKey: string) {
    setBusy(stepKey); setErr(null);
    try { await advanceCombinedPO(batch.anchorId, stepKey); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="success">Combined PO {batch.poNumber}</Badge>
          {batch.supplierCompany && <span className="text-muted-foreground">{batch.supplierCompany}</span>}
          <span className="text-muted-foreground">· {batch.members.length} requests</span>
        </div>
        <Badge variant={batch.variant}>{batch.statusLabel}</Badge>
      </div>

      <ul className="ml-4 list-disc text-xs text-muted-foreground">
        {batch.members.map((m, i) => (
          <li key={i}>
            <span className="font-medium text-foreground/80">{m.deptLabel}</span>
            {m.mrfNo && ` · MRF #${m.mrfNo}`} · {m.orderLabel} — {m.items.join(", ")}
          </li>
        ))}
      </ul>

      {batch.trail.length > 0 && <div className="mt-1 text-xs text-muted-foreground">{batch.trail.join(" · ")}</div>}

      {receiving ? (
        <div className="mt-2">
          <StockMatchPanel
            lines={batch.lines.map((l) => ({ label: `${l.description}${l.qty ? ` (${l.qty} ${l.unit})` : ""}`, qtyDefault: l.qty }))}
            stockItems={stockItems}
            submitLabel="Receive & add to stock"
            onCancel={() => setReceiving(false)}
            onSubmit={async (matches) => { await receiveCombinedPO(batch.anchorId, matches); setReceiving(false); router.refresh(); }}
          />
        </div>
      ) : actionable.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {actionable.map((a) => (
            <Button key={a.key} size="sm" variant={a.key === "reject" ? "outline" : "default"} className="h-7 text-xs"
              disabled={busy === a.key}
              onClick={() => (a.key === "receive" ? setReceiving(true) : run(a.key))}>
              {busy === a.key ? "Saving…" : a.label}
            </Button>
          ))}
        </div>
      ) : awaiting ? (
        <div className="mt-2 text-xs text-muted-foreground">Awaiting {awaiting.roleLabel}</div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
        <span className="text-muted-foreground">Net {formatCurrency(totals.net, "PHP")}</span>
        <a href={`/orders/${batch.orderIdForPrint}/po/${batch.anchorId}/xlsx`}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a]">
          <Printer className="h-3.5 w-3.5" /> Print PO &amp; 2307
        </a>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

function CombineForm({
  items,
  suppliers,
  paymentTerms,
  poDefaultRemarks,
  onCancel,
  onDone,
}: {
  items: CombinableItem[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  poDefaultRemarks: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const defaultLines = useMemo<POLine[]>(
    () => items.flatMap((it) => it.items.map((s) => poLineFromPRItem(s))),
    [items],
  );
  const [company, setCompany] = useState("");
  const [attention, setAttention] = useState("");
  const [address, setAddress] = useState("");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [date, setDate] = useState(todayInput());
  const [lines, setLines] = useState<POLine[]>(defaultLines.length ? defaultLines : [{ description: "", qty: "", unit: "", unitPrice: "" }]);
  const [withEwt, setWithEwt] = useState(true);
  const [ewtPct, setEwtPct] = useState("1");
  const [remarks, setRemarks] = useState(poDefaultRemarks);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matches = company.trim()
    ? suppliers.filter((s) => s.company.toLowerCase().includes(company.trim().toLowerCase()) && s.company.toLowerCase() !== company.trim().toLowerCase())
    : suppliers;

  function pickSupplier(s: Supplier) {
    setCompany(s.company);
    setAttention([s.contactPerson, s.contactNumber].filter(Boolean).join(" - "));
    if (s.address) setAddress(s.address);
    setSupplierOpen(false);
  }
  function setLine(i: number, key: keyof POLine, value: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  }

  const effectiveEwt = withEwt ? Number(ewtPct) || 0 : 0;
  const totals = poTotals({ lines, ewtPct: effectiveEwt });

  async function create() {
    if (company.trim() === "") { setErr("Enter the supplier."); return; }
    setBusy(true); setErr(null);
    try {
      await createCombinedPO(items.map((it) => it.id), {
        supplier: { company, attention, address },
        date,
        lines,
        ewtPct: effectiveEwt,
        remarks,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">New combined PO · {items.length} requests</div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Supplier</span>
          <div className="relative">
            <Input className="h-8" value={company} placeholder={suppliers.length ? "Search or type supplier…" : "Type supplier…"}
              onChange={(e) => { setCompany(e.target.value); setSupplierOpen(true); }}
              onFocus={() => setSupplierOpen(true)}
              onBlur={() => setTimeout(() => setSupplierOpen(false), 150)} />
            {supplierOpen && matches.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
                {matches.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSupplier(s)}
                      className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent">
                      <div className="font-medium">{s.company}</div>
                      {(s.contactPerson || s.contactNumber) && <div className="truncate text-xs text-muted-foreground">{[s.contactPerson, s.contactNumber].filter(Boolean).join(" · ")}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Attention</span>
          <Input className="h-8" value={attention} onChange={(e) => setAttention(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">Address</span>
          <Input className="h-8" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Date</span>
          <Input className="h-8" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="w-16 py-1 px-1 font-medium">Qty</th>
              <th className="w-16 py-1 px-1 font-medium">Unit</th>
              <th className="w-24 py-1 px-1 font-medium">Unit price</th>
              <th className="w-28 py-1 px-1 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1 pr-2"><Input className="h-8" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} /></td>
                <td className="py-1 px-1"><Input className="h-8 text-right" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} /></td>
                <td className="py-1 px-1"><Input className="h-8" value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} /></td>
                <td className="py-1 px-1"><Input className="h-8 text-right" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} /></td>
                <td className="py-1 px-1 text-right tabular-nums">{formatCurrency(poLineAmount(l), "PHP")}</td>
                <td className="py-1 text-center">
                  <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))} className="text-muted-foreground hover:text-destructive" aria-label="Remove line">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLines((ls) => [...ls, { description: "", qty: "", unit: "", unitPrice: "" }])}>+ Add line</Button>

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">EWT</span>
          <select className="h-7 rounded-md border bg-background px-2 text-xs" value={withEwt ? "with" : "without"}
            onChange={(e) => { const on = e.target.value === "with"; setWithEwt(on); if (on && !(Number(ewtPct) > 0)) setEwtPct("1"); }}>
            <option value="with">With EWT</option>
            <option value="without">Without EWT</option>
          </select>
        </div>
        <div className="flex justify-between"><span className="text-muted-foreground">Total amount</span><span className="tabular-nums">{formatCurrency(totals.total, "PHP")}</span></div>
        {withEwt && (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">Less EWT
              <Input className="h-6 w-14 text-right" value={ewtPct} onChange={(e) => setEwtPct(e.target.value)} />%
            </span>
            <span className="tabular-nums">{formatCurrency(totals.ewt, "PHP")}</span>
          </div>
        )}
        <div className="flex justify-between border-t pt-1 font-semibold"><span>Net amount</span><span className="tabular-nums">{formatCurrency(totals.net, "PHP")}</span></div>
      </div>

      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Payment terms</span>
        {paymentTerms.length > 0 && (
          <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value="" onChange={(e) => { if (e.target.value) setRemarks(e.target.value); }}>
            <option value="">— pick a saved payment term —</option>
            {paymentTerms.map((t) => <option key={t.id} value={t.text}>{t.text}</option>)}
          </select>
        )}
        <Input className="h-8" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Payment terms / remarks" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create combined PO"}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
