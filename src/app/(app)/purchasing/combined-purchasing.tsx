"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { poLineAmount, poTotals, poLineFromPRItem, type POLine } from "@/lib/purchase-order";
import type { Supplier } from "@/lib/suppliers";
import type { PaymentTerm } from "@/lib/payment-terms";
import type { PRStatus } from "@/lib/purchasing";
import { createCombinedPO, advanceCombinedPO, receiveCombinedPO, updateCombinedPO, cancelPurchaseRequest } from "../orders/actions";
import { isCancellable } from "@/lib/purchasing";
import { catalogPriceFor, withCatalogPrices, suppliersForDescription, type CatalogPrices, type CatalogSuppliers } from "@/lib/po-catalog";
import { StockMatchPanel, type StockOpt } from "../orders/[id]/stock-match-panel";

export interface CombinableItem {
  id: string;
  orderId: string;
  orderLabel: string;
  deptLabel: string;
  mrfNo: string | null;
  items: string[];
  supplierCompanies: string[];
}
export interface SupplierSuggestion {
  company: string;
  prIds: string[];
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
  supplierAttention: string;
  supplierAddress: string;
  ewtPct: number;
  remarks: string;
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
  suggestions = [],
  suppliers,
  paymentTerms,
  stockItems,
  canManagePO,
  poDefaultRemarks,
  catalogPrices = {},
  catalogSuppliers = {},
}: {
  combinable: CombinableItem[];
  batches: BatchCard[];
  suggestions?: SupplierSuggestion[];
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  stockItems: StockOpt[];
  canManagePO: boolean;
  poDefaultRemarks: string;
  catalogPrices?: CatalogPrices;
  catalogSuppliers?: CatalogSuppliers;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [presetCompany, setPresetCompany] = useState("");

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function acceptSuggestion(s: SupplierSuggestion) {
    setSel(new Set(s.prIds));
    setPresetCompany(s.company);
    setBuilding(true);
  }

  const selectedItems = combinable.filter((c) => sel.has(c.id));

  return (
    <div className="space-y-3">
      {/* Existing combined POs */}
      {batches.map((b) => (
        <BatchCardView key={b.anchorId} batch={b} stockItems={stockItems} suppliers={suppliers} paymentTerms={paymentTerms} poDefaultRemarks={poDefaultRemarks} catalogPrices={catalogPrices} catalogSuppliers={catalogSuppliers} />
      ))}

      {/* Combine builder */}
      {canManagePO && combinable.length > 0 && (
        <div className="rounded-md border p-3">
          {!building ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Combine requests into one PO</div>
                <Button size="sm" disabled={sel.size < 2} onClick={() => { setPresetCompany(""); setBuilding(true); }}>
                  Combine {sel.size > 0 ? `${sel.size} ` : ""}into one PO
                </Button>
              </div>

              {/* Auto-suggested combines: suppliers that can serve 2+ requests. */}
              {suggestions.length > 0 && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                  <div className="mb-1 text-xs font-medium text-primary">Suggested combines (same supplier)</div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button key={s.company} type="button" onClick={() => acceptSuggestion(s)}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
                        {s.company} · {s.prIds.length} requests →
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                      {c.supplierCompanies.length > 0 && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {c.supplierCompanies.map((co) => <Badge key={co} variant="secondary" className="font-normal">{co}</Badge>)}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <CombineForm
              title={`New combined PO · ${selectedItems.length} requests`}
              submitLabel="Create combined PO"
              initialLines={selectedItems.flatMap((it) => it.items.map((s) => poLineFromPRItem(s)))}
              presetCompany={presetCompany}
              suppliers={suppliers}
              paymentTerms={paymentTerms}
              poDefaultRemarks={poDefaultRemarks}
              catalogPrices={catalogPrices}
              catalogSuppliers={catalogSuppliers}
              onSubmit={(input) => createCombinedPO(selectedItems.map((it) => it.id), input)}
              onCancel={() => { setBuilding(false); setPresetCompany(""); }}
              onDone={() => { setBuilding(false); setPresetCompany(""); setSel(new Set()); router.refresh(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BatchCardView({ batch, stockItems, suppliers, paymentTerms, poDefaultRemarks, catalogPrices, catalogSuppliers }: { batch: BatchCard; stockItems: StockOpt[]; suppliers: Supplier[]; paymentTerms: PaymentTerm[]; poDefaultRemarks: string; catalogPrices: CatalogPrices; catalogSuppliers: CatalogSuppliers }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const totals = poTotals({ lines: batch.lines, ewtPct: batch.ewtPct });
  const actionable = batch.actions.filter((a) => a.canAct);
  const awaiting = batch.actions.find((a) => !a.canAct);
  const editable = batch.canManagePO && (["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY"] as string[]).includes(batch.status);

  async function run(stepKey: string) {
    setBusy(stepKey); setErr(null);
    try { await advanceCombinedPO(batch.anchorId, stepKey); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }
  const cancellable = batch.canManagePO && isCancellable(batch.status);
  async function cancel() {
    if (!window.confirm(`Cancel combined PO ${batch.poNumber}? This withdraws all ${batch.members.length} requests.`)) return;
    setBusy("cancel"); setErr(null);
    try { await cancelPurchaseRequest(batch.anchorId); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  if (editing) {
    return (
      <div className="rounded-md border p-3">
        <CombineForm
          title={`Edit combined PO ${batch.poNumber} · ${batch.members.length} requests`}
          submitLabel="Save changes"
          initialLines={batch.lines}
          presetCompany={batch.supplierCompany}
          initialAttention={batch.supplierAttention}
          initialAddress={batch.supplierAddress}
          initialEwtPct={batch.ewtPct}
          initialRemarks={batch.remarks}
          suppliers={suppliers}
          paymentTerms={paymentTerms}
          poDefaultRemarks={poDefaultRemarks}
          catalogPrices={catalogPrices}
          catalogSuppliers={catalogSuppliers}
          onSubmit={(input) => updateCombinedPO(batch.anchorId, input)}
          onCancel={() => setEditing(false)}
          onDone={() => { setEditing(false); router.refresh(); }}
        />
      </div>
    );
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

      {/* PO lines with prices for the purchaser's reference. */}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="w-16 py-1 px-1 text-right font-medium">Qty</th>
              <th className="w-24 py-1 px-1 text-right font-medium">Unit price</th>
              <th className="w-24 py-1 px-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {batch.lines.map((l, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1 pr-2">{l.description}</td>
                <td className="py-1 px-1 text-right tabular-nums">{[l.qty, l.unit].filter(Boolean).join(" ")}</td>
                <td className="py-1 px-1 text-right tabular-nums">{l.unitPrice ? formatCurrency(Number(l.unitPrice), "PHP") : "—"}</td>
                <td className="py-1 px-1 text-right tabular-nums">{poLineAmount(l) ? formatCurrency(poLineAmount(l), "PHP") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
        <span className="text-muted-foreground">
          Total {formatCurrency(totals.total, "PHP")}
          {batch.ewtPct > 0 && <> · less EWT {formatCurrency(totals.ewt, "PHP")}</>}
          {" · "}<span className="font-semibold text-foreground">Net {formatCurrency(totals.net, "PHP")}</span>
        </span>
        <div className="flex items-center gap-2">
          {cancellable && (
            <button type="button" onClick={cancel} disabled={busy === "cancel"}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-destructive">
              {busy === "cancel" ? "…" : "Cancel"}
            </button>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-[#ED1C24] transition-colors hover:bg-[#ED1C24]/10">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          <a href={`/orders/${batch.orderIdForPrint}/po/${batch.anchorId}/xlsx`}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#c2141a]">
            <Printer className="h-3.5 w-3.5" /> Print PO &amp; 2307
          </a>
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

function CombineForm({
  title,
  submitLabel,
  initialLines,
  presetCompany = "",
  initialAttention,
  initialAddress,
  initialEwtPct,
  initialRemarks,
  suppliers,
  paymentTerms,
  poDefaultRemarks,
  catalogPrices,
  catalogSuppliers,
  onSubmit,
  onCancel,
  onDone,
}: {
  title: string;
  submitLabel: string;
  initialLines: POLine[];
  presetCompany?: string;
  initialAttention?: string;
  initialAddress?: string;
  initialEwtPct?: number;
  initialRemarks?: string;
  suppliers: Supplier[];
  paymentTerms: PaymentTerm[];
  poDefaultRemarks: string;
  catalogPrices: CatalogPrices;
  catalogSuppliers: CatalogSuppliers;
  onSubmit: (input: { supplier: { company: string; attention: string; address: string }; date: string; lines: POLine[]; ewtPct: number; remarks: string }) => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const preset = presetCompany ? suppliers.find((s) => s.company.toLowerCase() === presetCompany.toLowerCase()) : undefined;
  const [company, setCompany] = useState(presetCompany);
  const [attention, setAttention] = useState(initialAttention ?? (preset ? [preset.contactPerson, preset.contactNumber].filter(Boolean).join(" - ") : ""));
  const [address, setAddress] = useState(initialAddress ?? preset?.address ?? "");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [date, setDate] = useState(todayInput());
  // Pre-fill line prices from the catalogue for the chosen supplier.
  const seededLines = withCatalogPrices(initialLines.length ? initialLines : [{ description: "", qty: "", unit: "", unitPrice: "" }], presetCompany, catalogPrices);
  const [lines, setLines] = useState<POLine[]>(seededLines);
  const [withEwt, setWithEwt] = useState((initialEwtPct ?? 1) > 0);
  const [ewtPct, setEwtPct] = useState(String(initialEwtPct && initialEwtPct > 0 ? initialEwtPct : 1));
  const [remarks, setRemarks] = useState(initialRemarks ?? poDefaultRemarks);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Suppliers that carry at least one of the requested products (from the catalogue).
  const carrierSet = new Set<string>();
  for (const l of lines) for (const co of suppliersForDescription(l.description, catalogSuppliers)) carrierSet.add(co.toLowerCase());
  // Only show suppliers that carry the products; fall back to all when nothing matched.
  const eligible = carrierSet.size > 0 ? suppliers.filter((s) => carrierSet.has(s.company.toLowerCase())) : suppliers;
  const filtered = carrierSet.size > 0;

  const matches = company.trim()
    ? eligible.filter((s) => s.company.toLowerCase().includes(company.trim().toLowerCase()) && s.company.toLowerCase() !== company.trim().toLowerCase())
    : eligible;
  const canFillPrices = company.trim() !== "" && lines.some((l) => !l.unitPrice && catalogPriceFor(l.description, company.trim().toLowerCase(), catalogPrices));

  function pickSupplier(s: Supplier) {
    setCompany(s.company);
    setAttention([s.contactPerson, s.contactNumber].filter(Boolean).join(" - "));
    if (s.address) setAddress(s.address);
    setSupplierOpen(false);
    setLines((ls) => withCatalogPrices(ls, s.company, catalogPrices, true));
  }

  // When exactly one supplier carries the products, auto-populate it on open.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current) return;
    if (!company && filtered && eligible.length === 1) {
      autoPicked.current = true;
      pickSupplier(eligible[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function setLine(i: number, key: keyof POLine, value: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  }

  const effectiveEwt = withEwt ? Number(ewtPct) || 0 : 0;
  const totals = poTotals({ lines, ewtPct: effectiveEwt });

  async function submit() {
    if (company.trim() === "") { setErr("Enter the supplier."); return; }
    setBusy(true); setErr(null);
    try {
      await onSubmit({ supplier: { company, attention, address }, date, lines, ewtPct: effectiveEwt, remarks });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{title}</div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Supplier</span>
          <div className="relative">
            <Input className="h-8" value={company} placeholder={filtered ? "Suppliers that carry these items…" : suppliers.length ? "Search or type supplier…" : "Type supplier…"}
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
          {filtered && (
            <p className="text-[11px] text-muted-foreground">
              Showing {eligible.length} supplier{eligible.length === 1 ? "" : "s"} that carry these products. Type to use another.
            </p>
          )}
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
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLines((ls) => [...ls, { description: "", qty: "", unit: "", unitPrice: "" }])}>+ Add line</Button>
        {canFillPrices && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLines((ls) => withCatalogPrices(ls, company, catalogPrices))}>
            Fill prices from {company}
          </Button>
        )}
      </div>

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
        <Button size="sm" className="h-8" disabled={busy} onClick={submit}>{busy ? "Saving…" : submitLabel}</Button>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
