"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ScanLine, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { code128Svg } from "@/lib/code128";
import { qrSvg } from "@/lib/qr";
import { BulkImport } from "./bulk-import";
import { createStockItem, adjustStock, updateStockItemMeta, reserveStock, releaseReservation, assignMissingSkus } from "./actions";

interface Reservation {
  id: string;
  qty: number;
  forRef: string;
  note: string | null;
  byName: string;
}
interface Item {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  category: string | null;
  location: string | null;
  quantity: number;
  reorderLevel: number;
  unitCost: number;
  value: number;
  reserved: number;
  available: number;
  reservations: Reservation[];
  status: "ok" | "low" | "out";
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Location picker: a dropdown of admin-managed locations, or a free-text box when none are configured. */
function LocationField({ value, onChange, locations, className }: { value: string; onChange: (v: string) => void; locations: string[]; className?: string }) {
  if (locations.length === 0) {
    return <Input className={className ?? "h-8 w-40"} placeholder="e.g. A-3-2" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  // Include the current value even if it isn't in the managed list (legacy data), so it isn't silently dropped.
  const extra = value && !locations.includes(value) ? [value] : [];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${className ?? "h-8 w-40"} rounded-md border bg-background px-2 text-sm`}>
      <option value="">—</option>
      {[...locations, ...extra].map((loc) => <option key={loc} value={loc}>{loc}</option>)}
    </select>
  );
}

function StockRow({ item, canManage, locations, scanTarget, scanNonce }: { item: Item; canManage: boolean; locations: string[]; scanTarget: string | null; scanNonce: number }) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "adjust" | "edit" | "reserve" | "label">("none");
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [flash, setFlash] = useState(false);

  // A scan that matches this item opens its Adjust panel and scrolls to it.
  useEffect(() => {
    if (scanTarget && scanTarget === item.id) {
      setPanel("adjust");
      setFlash(true);
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanNonce]);

  const [kind, setKind] = useState<"RECEIPT" | "ISSUE" | "ADJUSTMENT">("RECEIPT");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  // Edit fields
  const [category, setCategory] = useState(item.category ?? "");
  const [location, setLocation] = useState(item.location ?? "");
  const [reorder, setReorder] = useState(String(item.reorderLevel));
  const [unitCost, setUnitCost] = useState(String(item.unitCost));
  // Reserve fields
  const [resvQty, setResvQty] = useState("");
  const [resvRef, setResvRef] = useState("");
  const [resvNote, setResvNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, keepOpen = false) {
    setBusy(true); setErr(null);
    try { await fn(); if (!keepOpen) setPanel("none"); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  function apply() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0) { setErr("Enter a quantity."); return; }
    run(() => adjustStock({ stockItemId: item.id, kind, qty: n, reason }).then(() => { setQty(""); setReason(""); }));
  }
  function saveMeta() {
    run(() => updateStockItemMeta({ stockItemId: item.id, category, location, reorderLevel: Number(reorder) || 0, unitCost: Number(unitCost) || 0 }));
  }
  function reserve() {
    const n = Number(resvQty);
    if (!(n > 0)) { setErr("Enter a quantity."); return; }
    if (resvRef.trim() === "") { setErr("Enter what it's reserved for."); return; }
    run(() => reserveStock({ stockItemId: item.id, qty: n, forRef: resvRef, note: resvNote || undefined }).then(() => { setResvQty(""); setResvRef(""); setResvNote(""); }), true);
  }

  return (
    <>
      <TableRow ref={rowRef} className={flash ? "bg-primary/10 transition-colors" : undefined}>
        <TableCell>
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-muted-foreground">{[item.sku ? `SKU ${item.sku}` : null, item.category].filter(Boolean).join(" · ")}</div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{item.unit}</TableCell>
        <TableCell className="text-sm">{item.location || <span className="text-muted-foreground">—</span>}</TableCell>
        <TableCell className="text-right tabular-nums font-medium">{fmt(item.quantity)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{item.reserved ? fmt(item.reserved) : "—"}</TableCell>
        <TableCell className={`text-right tabular-nums font-medium ${item.available < 0 ? "text-destructive" : ""}`}>{fmt(item.available)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(item.reorderLevel)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{item.unitCost ? peso(item.unitCost) : "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{item.value ? peso(item.value) : "—"}</TableCell>
        <TableCell>
          {item.status === "out" ? <Badge variant="destructive">Out</Badge>
            : item.status === "low" ? <Badge variant="warning">Low</Badge>
            : <Badge variant="success">OK</Badge>}
        </TableCell>
        {canManage && (
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "label" ? "none" : "label"))}>Label</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "reserve" ? "none" : "reserve"))}>Reserve{item.reservations.length ? ` (${item.reservations.length})` : ""}</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "edit" ? "none" : "edit"))}>Edit</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "adjust" ? "none" : "adjust"))}>Adjust</Button>
            </div>
          </TableCell>
        )}
      </TableRow>
      {panel === "adjust" && canManage && (
        <TableRow>
          <TableCell colSpan={11} className="bg-muted/30">
            <div className="flex flex-wrap items-end gap-2 py-1">
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-8 rounded-md border bg-background px-2 text-sm">
                <option value="RECEIPT">Receive (+)</option>
                <option value="ISSUE">Issue (−)</option>
                <option value="ADJUSTMENT">Set to</option>
              </select>
              <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input className="h-8 w-56" placeholder="Reason / reference (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" className="h-8" disabled={busy} onClick={apply}>{busy ? "…" : "Apply"}</Button>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "edit" && canManage && (
        <TableRow>
          <TableCell colSpan={11} className="bg-muted/30">
            <div className="flex flex-wrap items-end gap-2 py-1">
              <label className="text-xs text-muted-foreground">Location<div><LocationField value={location} onChange={setLocation} locations={locations} /></div></label>
              <label className="text-xs text-muted-foreground">Unit cost (₱)<Input className="h-8 w-28" type="number" step="any" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Reorder at<Input className="h-8 w-28" type="number" step="any" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Category<Input className="h-8 w-40" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
              <Button size="sm" className="h-8" disabled={busy} onClick={saveMeta}>{busy ? "…" : "Save"}</Button>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "reserve" && canManage && (
        <TableRow>
          <TableCell colSpan={11} className="bg-muted/30">
            <div className="space-y-2 py-1">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">Reserve qty<Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={resvQty} onChange={(e) => setResvQty(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">For (order / job)<Input className="h-8 w-44" placeholder="e.g. AFBM-JO2600054" value={resvRef} onChange={(e) => setResvRef(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">Note<Input className="h-8 w-44" placeholder="optional" value={resvNote} onChange={(e) => setResvNote(e.target.value)} /></label>
                <Button size="sm" className="h-8" disabled={busy} onClick={reserve}>{busy ? "…" : "Reserve"}</Button>
                <span className="text-xs text-muted-foreground">{fmt(item.available)} {item.unit} available</span>
                {err && <span className="text-xs text-destructive">{err}</span>}
              </div>
              {item.reservations.length > 0 && (
                <ul className="space-y-1">
                  {item.reservations.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs">
                      <span className="font-medium tabular-nums">{fmt(r.qty)} {item.unit}</span>
                      <span>→ {r.forRef}</span>
                      {r.note && <span className="text-muted-foreground">· {r.note}</span>}
                      <span className="text-muted-foreground">· {r.byName}</span>
                      <button type="button" className="ml-auto rounded border px-2 py-0.5 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => run(() => releaseReservation(r.id), true)}>Release</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "label" && (
        <TableRow>
          <TableCell colSpan={11} className="bg-muted/30">
            <div className="flex flex-col items-start gap-1 py-1">
              <div className="text-sm font-medium">{item.name}{item.sku ? ` · SKU ${item.sku}` : ""}{item.location ? ` · Loc ${item.location}` : ""}</div>
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line react/no-danger */}
                <div dangerouslySetInnerHTML={{ __html: code128Svg(item.sku ?? item.id, { moduleWidth: 2, height: 48 }) }} />
                {/* eslint-disable-next-line react/no-danger */}
                <div dangerouslySetInnerHTML={{ __html: qrSvg(item.sku ?? item.id, { scale: 3 }) }} />
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/inventory/labels?ids=${item.id}`} className="text-xs font-medium text-primary hover:underline">Print this label →</Link>
                <span className="text-[10px] text-muted-foreground">Code 128 + QR · any barcode scanner.</span>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function InventoryManager({ items, canManage, locations }: { items: Item[]; canManage: boolean; locations: string[] }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState("");
  const [reorder, setReorder] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Scan box: a barcode scanner "types" the SKU + Enter here. Mode decides what a
  // scan does — jump to the item, or directly receive / issue the entered qty.
  const [scan, setScan] = useState("");
  const [scanMode, setScanMode] = useState<"find" | "receive" | "issue">("find");
  const [scanQty, setScanQty] = useState("1");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanTarget, setScanTarget] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  // Text search: filter by name, SKU, category or location.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q === ""
    ? items
    : items.filter((it) =>
        it.name.toLowerCase().includes(q) ||
        (it.sku ?? "").toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q) ||
        (it.location ?? "").toLowerCase().includes(q),
      );

  async function onScanKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const found =
      items.find((i) => i.sku === code) ??
      items.find((i) => i.id === code) ??
      items.find((i) => i.name.toLowerCase() === code.toLowerCase());
    if (!found) { setScanErr(true); setScanMsg(`No item matches “${code}”.`); return; }
    if (scanMode === "find") {
      setScanTarget(found.id); setScanNonce((n) => n + 1); setScanErr(false); setScanMsg(`Found: ${found.name}`);
      return;
    }
    const q = Number(scanQty);
    if (!(q > 0)) { setScanErr(true); setScanMsg("Enter a quantity first."); return; }
    setScanBusy(true);
    try {
      await adjustStock({
        stockItemId: found.id,
        kind: scanMode === "receive" ? "RECEIPT" : "ISSUE",
        qty: q,
        reason: scanMode === "receive" ? "Scan receive" : "Scan issue",
      });
      setScanErr(false);
      setScanMsg(`${scanMode === "receive" ? "Received" : "Issued"} ${q} ${found.unit} · ${found.name}`);
      router.refresh();
    } catch (e2) {
      setScanErr(true); setScanMsg(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setScanBusy(false);
      scanRef.current?.focus();
    }
  }

  async function add() {
    if (name.trim() === "") { setErr("Enter an item name."); return; }
    setBusy(true); setErr(null);
    try {
      await createStockItem({
        name, unit, category: category || undefined, location: location || undefined,
        quantity: Number(qty) || 0, reorderLevel: Number(reorder) || 0, unitCost: Number(unitCost) || 0,
      });
      setName(""); setCategory(""); setLocation(""); setQty(""); setReorder(""); setUnitCost(""); setUnit("pcs"); setShowAdd(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Scan box: a scanner types the SKU + Enter. Mode = jump / receive / issue. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
        <div className="relative">
          <ScanLine className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={scanRef} className="h-9 w-56 pl-8" placeholder="Scan barcode…" value={scan} autoFocus disabled={scanBusy}
            onChange={(e) => setScan(e.target.value)} onKeyDown={onScanKey} />
        </div>
        {canManage && (
          <select value={scanMode} onChange={(e) => { setScanMode(e.target.value as typeof scanMode); scanRef.current?.focus(); }}
            className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="find">Scan → jump to item</option>
            <option value="receive">Scan → receive</option>
            <option value="issue">Scan → issue</option>
          </select>
        )}
        {canManage && scanMode !== "find" && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Qty<Input className="h-9 w-20" type="number" step="any" min={0} value={scanQty} onChange={(e) => setScanQty(e.target.value)} />
          </label>
        )}
        {scanMsg && <span className={`text-xs ${scanErr ? "text-destructive" : "text-emerald-600"}`}>{scanMsg}</span>}
        {canManage && items.some((i) => !i.sku) && (
          <Button size="sm" variant="outline" className="ml-auto h-9 text-xs" disabled={busy}
            onClick={async () => { setBusy(true); try { await assignMissingSkus(); router.refresh(); } finally { setBusy(false); } }}>
            {busy ? "…" : `Generate SKUs (${items.filter((i) => !i.sku).length})`}
          </Button>
        )}
      </div>

      {canManage && (
        <div>
          {showAdd ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">New stock item</div>
              <div className="flex flex-wrap items-end gap-2">
                <Input className="h-8 w-56" placeholder="Name (e.g. GI sheet 24ga)" value={name} onChange={(e) => setName(e.target.value)} />
                <Input className="h-8 w-24" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                <Input className="h-8 w-40" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
                <LocationField value={location} onChange={setLocation} locations={locations} className="h-8 w-40" />
                <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Opening qty" value={qty} onChange={(e) => setQty(e.target.value)} />
                <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Reorder at" value={reorder} onChange={(e) => setReorder(e.target.value)} />
                <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Unit cost ₱" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                <Button size="sm" className="h-8" disabled={busy} onClick={add}>{busy ? "Saving…" : "Add item"}</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setShowAdd(true)}>+ Add stock item</Button>
              <BulkImport />
            </div>
          )}
        </div>
      )}

      {/* Text search across name / SKU / category / location. */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 pl-8" placeholder="Search items by name, SKU, category or location…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {q !== "" && (
          <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No stock items yet.</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No items match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="overflow-x-auto">
          {q !== "" && <p className="mb-1 text-xs text-muted-foreground">{filtered.length} of {items.length} items</p>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((it) => <StockRow key={it.id} item={it} canManage={canManage} locations={locations} scanTarget={scanTarget} scanNonce={scanNonce} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
