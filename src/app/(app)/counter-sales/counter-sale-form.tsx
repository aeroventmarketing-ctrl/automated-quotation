"use client";

import { useMemo, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, isNextControlFlowError } from "@/lib/utils";
import { PAYMENT_METHODS } from "@/lib/counter-sale";
import { createCounterSale, type CounterSaleItemInput } from "./actions";

interface StockOpt { id: string; name: string; unit: string; sellPrice: number; quantity: number }
interface Line { stockItemId: string; description: string; unit: string; qty: string; unitPrice: string }

const VAT_RATE = 0.12;
const emptyLine = (): Line => ({ stockItemId: "__adhoc", description: "", unit: "pcs", qty: "1", unitPrice: "" });

export function CounterSaleForm({
  customers,
  stockItems,
  salespeople,
}: {
  customers: { id: string; company: string }[];
  stockItems: StockOpt[];
  salespeople: { id: string; name: string }[];
}) {
  const [customerId, setCustomerId] = useState("__new");
  const [customerSearch, setCustomerSearch] = useState("");
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const [vatMode, setVatMode] = useState<"INCLUSIVE" | "EXCLUSIVE">("INCLUSIVE");
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].key);
  const [salespersonId, setSalespersonId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isNewCustomer = customerId === "__new";
  const q = customerSearch.trim().toLowerCase();
  const filteredCustomers = q ? customers.filter((c) => c.company.toLowerCase().includes(q)) : customers;
  const selected = customers.find((c) => c.id === customerId);
  const listCustomers = selected && !filteredCustomers.some((c) => c.id === selected.id) ? [selected, ...filteredCustomers] : filteredCustomers;

  const stockById = useMemo(() => new Map(stockItems.map((s) => [s.id, s])), [stockItems]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  function pickStock(i: number, id: string) {
    if (id === "__adhoc") { setLine(i, { stockItemId: id }); return; }
    const s = stockById.get(id);
    if (s) setLine(i, { stockItemId: id, description: s.name, unit: s.unit, unitPrice: s.sellPrice ? String(s.sellPrice) : "" });
  }

  const num = (s: string) => { const n = Number((s || "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
  const lineTotal = (l: Line) => Math.round(num(l.qty) * num(l.unitPrice) * 100) / 100;
  const grand = Math.round(lines.reduce((a, l) => a + lineTotal(l), 0) * 100) / 100;
  const subtotal = vatMode === "INCLUSIVE" ? Math.round((grand / (1 + VAT_RATE)) * 100) / 100 : grand;
  const vat = vatMode === "INCLUSIVE" ? Math.round((grand - subtotal) * 100) / 100 : 0;

  async function submit() {
    setErr(null);
    if (isNewCustomer && !company.trim()) { setErr("Enter the client's company or name."); return; }
    const items: CounterSaleItemInput[] = lines
      .filter((l) => l.description.trim() && num(l.qty) > 0)
      .map((l) => ({ stockItemId: l.stockItemId === "__adhoc" ? null : l.stockItemId, description: l.description.trim(), unit: l.unit, qty: num(l.qty), unitPrice: num(l.unitPrice) }));
    if (items.length === 0) { setErr("Add at least one item with a quantity."); return; }
    setBusy(true);
    try {
      await createCounterSale({
        customerId: isNewCustomer ? undefined : customerId,
        newCustomer: isNewCustomer ? { company, contactName, email, phone, address } : undefined,
        vatMode,
        salespersonId: salespersonId || undefined,
        paymentMethod,
        notes,
        items,
      });
    } catch (e) {
      if (isNextControlFlowError(e)) throw e; // let the redirect navigate
      setErr(e instanceof Error ? e.message : "Failed to create the sale");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Client */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Client</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Existing Client</Label>
              <Input placeholder="Search company / name…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="__new">+ New Client (Walk-in)</option>
                {listCustomers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
              </Select>
            </div>
          </div>
          {isNewCustomer && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Company / Name <span className="text-destructive">*</span></Label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company or personal name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contact Person</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Address</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Items</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-12 sm:items-end">
              <div className="space-y-1 sm:col-span-4">
                <Label className="text-[11px] text-muted-foreground">Item</Label>
                <Select value={l.stockItemId} onChange={(e) => pickStock(i, e.target.value)}>
                  <option value="__adhoc">Ad-hoc / Not In Inventory</option>
                  {stockItems.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.quantity} {s.unit} On Hand</option>)}
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label className="text-[11px] text-muted-foreground">Description</Label>
                <Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Item name" />
              </div>
              <div className="space-y-1 sm:col-span-1">
                <Label className="text-[11px] text-muted-foreground">Qty</Label>
                <Input className="text-right" type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[11px] text-muted-foreground">Unit Price</Label>
                <Input className="text-right" type="number" min={0} step="any" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
              </div>
              <div className="flex items-center justify-between gap-2 sm:col-span-2">
                <span className="text-sm font-medium tabular-nums">{formatCurrency(lineTotal(l))}</span>
                <button type="button" className="text-muted-foreground hover:text-destructive disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove line">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Item
          </Button>
        </CardContent>
      </Card>

      {/* Sale details */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Sale &amp; Payment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">VAT Presentation</Label>
              <Select value={vatMode} onChange={(e) => setVatMode(e.target.value as "INCLUSIVE" | "EXCLUSIVE")}>
                <option value="INCLUSIVE">VAT Inclusive (SI + CR + DR)</option>
                <option value="EXCLUSIVE">VAT Exclusive (Delivery Form + Acknowledgement)</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payment Method</Label>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credited Salesperson</Label>
              <Select value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}>
                <option value="">— None —</option>
                {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — e.g. check no., reference" />
          </div>

          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Net{vatMode === "INCLUSIVE" ? " Of VAT" : ""}</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
            {vatMode === "INCLUSIVE" && <div className="flex justify-between"><span className="text-muted-foreground">VAT (12%)</span><span className="tabular-nums">{formatCurrency(vat)}</span></div>}
            <div className="flex justify-between border-t pt-1 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(grand)}</span></div>
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex items-center gap-2">
            <Button disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create Sale"}</Button>
            <span className="text-xs text-muted-foreground">You&apos;ll attach the documents and complete the sale on the next screen.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
