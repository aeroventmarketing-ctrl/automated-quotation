"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ScanLine, Search, X, Eye, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { code128Svg } from "@/lib/code128";
import { qrSvg } from "@/lib/qr";
import { BulkImport } from "./bulk-import";
import { createStockItem, adjustStock, updateStockItemPrices, releaseReservation, assignMissingSkus, mergeDuplicateStockItems } from "./actions";
import { proposeStockAction } from "./stock-action-actions";
import { PendingChip, PendingStockActions } from "./pending-stock-actions";
import type { StockActionView, StockDoc } from "@/lib/stock-action";

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
  sellPrice: number;
  value: number;
  reserved: number;
  available: number;
  reservations: Reservation[];
  status: "ok" | "low" | "out";
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

type SortKey = "name" | "quantity" | "available" | "reorderLevel" | "unitCost" | "sellPrice" | "value" | "status" | "location" | "category";
type GroupKey = "none" | "location" | "category" | "status";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "quantity", label: "On hand" },
  { key: "available", label: "Available" },
  { key: "reorderLevel", label: "Reorder at" },
  { key: "unitCost", label: "Unit cost" },
  { key: "sellPrice", label: "Sell price" },
  { key: "value", label: "Value" },
  { key: "status", label: "Status" },
  { key: "location", label: "Location" },
  { key: "category", label: "Category" },
];
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "location", label: "Location" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
];

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

function StockRow({ item, canManage, showPrices, canEditPrices, locations, scanTarget, scanNonce, pending = [] }: { item: Item; canManage: boolean; showPrices: boolean; canEditPrices: boolean; locations: string[]; scanTarget: string | null; scanNonce: number; pending?: StockActionView[] }) {
  const router = useRouter();
  // Purchaser/admin who aren't the stock manager still get a "Set price" action.
  const priceOnly = canEditPrices && !canManage;
  const hasActions = canManage || canEditPrices;
  // Table has 8 always-on columns + 3 price columns (unit cost, sell price,
  // value) + 1 action column; the expandable panels span all of them.
  const colSpan = 8 + (showPrices ? 3 : 0) + (hasActions ? 1 : 0);
  const [panel, setPanel] = useState<"none" | "adjust" | "edit" | "price" | "reserve" | "transfer" | "label">("none");
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
  const [sellPrice, setSellPrice] = useState(String(item.sellPrice));
  // Reserve fields
  const [resvQty, setResvQty] = useState("");
  const [resvRef, setResvRef] = useState("");
  const [resvNote, setResvNote] = useState("");
  // Transfer fields
  const [xferQty, setXferQty] = useState("");
  const [xferTo, setXferTo] = useState("");
  const [xferNote, setXferNote] = useState("");
  const [xferProof, setXferProof] = useState<StockDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, keepOpen = false) {
    setBusy(true); setErr(null);
    try { await fn(); if (!keepOpen) setPanel("none"); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  // Edit / Adjust / Reserve / Transfer are PROPOSED — they only take effect once
  // both a Warehouseman and a Purchaser approve (double handshake).
  function apply() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0) { setErr("Enter a quantity."); return; }
    run(() => proposeStockAction("ADJUST", item.id, { kind, qty: n, reason }).then(() => { setQty(""); setReason(""); }));
  }
  function saveMeta() {
    run(() => proposeStockAction("EDIT", item.id, { category, location, reorderLevel: Number(reorder) || 0, unitCost: Number(unitCost) || 0, sellPrice: Number(sellPrice) || 0 }));
  }
  function savePrices() {
    run(() => updateStockItemPrices({ stockItemId: item.id, unitCost: Number(unitCost) || 0, sellPrice: Number(sellPrice) || 0 }));
  }
  function reserve() {
    const n = Number(resvQty);
    if (!(n > 0)) { setErr("Enter a quantity."); return; }
    if (resvRef.trim() === "") { setErr("Enter what it's reserved for."); return; }
    run(() => proposeStockAction("RESERVE", item.id, { qty: n, forRef: resvRef, note: resvNote || undefined }).then(() => { setResvQty(""); setResvRef(""); setResvNote(""); }));
  }
  async function uploadProof(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Group the upload under the item (no transfer record exists yet at propose time).
      fd.append("transferId", `propose-${item.id}`);
      const res = await fetch("/api/transfer-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setXferProof(data as StockDoc);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  function transfer() {
    const n = Number(xferQty);
    if (!(n > 0)) { setErr("Enter a quantity."); return; }
    if (xferTo.trim() === "") { setErr("Choose a destination location."); return; }
    if (!xferProof) { setErr("Upload the stock transfer form first."); return; }
    run(() => proposeStockAction("TRANSFER", item.id, { qty: n, toLocation: xferTo.trim(), note: xferNote || undefined, proof: xferProof }).then(() => { setXferQty(""); setXferTo(""); setXferNote(""); setXferProof(null); }));
  }

  return (
    <>
      <TableRow ref={rowRef} className={flash ? "bg-primary/10 transition-colors" : undefined}>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-medium">{item.name}</span>
            {showPrices && item.sellPrice <= 0 && (
              <Badge variant="warning" className="font-normal">No sell price</Badge>
            )}
            <PendingChip pending={pending} />
          </div>
          <div className="text-xs text-muted-foreground">{[item.sku ? `SKU ${item.sku}` : null, item.category].filter(Boolean).join(" · ")}</div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{item.unit}</TableCell>
        <TableCell className="text-sm">{item.location || <span className="text-muted-foreground">—</span>}</TableCell>
        <TableCell className="text-right tabular-nums font-medium">{fmt(item.quantity)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{item.reserved ? fmt(item.reserved) : "—"}</TableCell>
        <TableCell className={`text-right tabular-nums font-medium ${item.available < 0 ? "text-destructive" : ""}`}>{fmt(item.available)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(item.reorderLevel)}</TableCell>
        {showPrices && <TableCell className="text-right tabular-nums text-muted-foreground">{item.unitCost ? peso(item.unitCost) : "—"}</TableCell>}
        {showPrices && <TableCell className="text-right tabular-nums font-medium text-emerald-700">{item.sellPrice ? peso(item.sellPrice) : "—"}</TableCell>}
        {showPrices && <TableCell className="text-right tabular-nums">{item.value ? peso(item.value) : "—"}</TableCell>}
        <TableCell>
          {item.status === "out" ? <Badge variant="destructive">Out</Badge>
            : item.status === "low" ? <Badge variant="warning">Low</Badge>
            : <Badge variant="success">OK</Badge>}
        </TableCell>
        {hasActions && (
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              {priceOnly ? (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "price" ? "none" : "price"))}>
                  {item.sellPrice <= 0 ? "Set price" : "Edit price"}
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "label" ? "none" : "label"))}>Label</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "reserve" ? "none" : "reserve"))}>Reserve{item.reservations.length ? ` (${item.reservations.length})` : ""}</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "transfer" ? "none" : "transfer"))}>Transfer</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "edit" ? "none" : "edit"))}>Edit</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "adjust" ? "none" : "adjust"))}>Adjust</Button>
                </>
              )}
            </div>
          </TableCell>
        )}
      </TableRow>
      {panel === "adjust" && canManage && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="flex flex-wrap items-end gap-2 py-1">
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-8 rounded-md border bg-background px-2 text-sm">
                <option value="RECEIPT">Receive (+)</option>
                <option value="ISSUE">Issue (−)</option>
                <option value="ADJUSTMENT">Set to</option>
              </select>
              <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input className="h-8 w-56" placeholder="Reason / reference (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" className="h-8" disabled={busy} onClick={apply}>{busy ? "…" : "Propose"}</Button>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "edit" && canManage && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="flex flex-wrap items-end gap-2 py-1">
              <label className="text-xs text-muted-foreground">Location<div><LocationField value={location} onChange={setLocation} locations={locations} /></div></label>
              {showPrices && <label className="text-xs text-muted-foreground">Unit cost (₱)<Input className="h-8 w-28" type="number" step="any" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></label>}
              {showPrices && <label className="text-xs text-muted-foreground">Sell price (₱)<Input className="h-8 w-28" type="number" step="any" min={0} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></label>}
              <label className="text-xs text-muted-foreground">Reorder at<Input className="h-8 w-28" type="number" step="any" min={0} value={reorder} onChange={(e) => setReorder(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Category<Input className="h-8 w-40" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
              <Button size="sm" className="h-8" disabled={busy} onClick={saveMeta}>{busy ? "…" : "Propose edit"}</Button>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "price" && priceOnly && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="flex flex-wrap items-end gap-2 py-1">
              <label className="text-xs text-muted-foreground">Unit cost (₱)<Input className="h-8 w-28" type="number" step="any" min={0} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">Sell price (₱)<Input className="h-8 w-28" type="number" step="any" min={0} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} /></label>
              <Button size="sm" className="h-8" disabled={busy} onClick={savePrices}>{busy ? "…" : "Save price"}</Button>
              <span className="text-xs text-muted-foreground">Selling price is what Sales sees on Check availability.</span>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "reserve" && canManage && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="space-y-2 py-1">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">Reserve qty<Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={resvQty} onChange={(e) => setResvQty(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">For (order / job)<Input className="h-8 w-44" placeholder="e.g. AFBM-JO2600054" value={resvRef} onChange={(e) => setResvRef(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">Note<Input className="h-8 w-44" placeholder="optional" value={resvNote} onChange={(e) => setResvNote(e.target.value)} /></label>
                <Button size="sm" className="h-8" disabled={busy} onClick={reserve}>{busy ? "…" : "Propose reserve"}</Button>
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
      {panel === "transfer" && canManage && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="flex flex-wrap items-end gap-2 py-1">
              <label className="text-xs text-muted-foreground">Transfer qty<Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Qty" value={xferQty} onChange={(e) => setXferQty(e.target.value)} /></label>
              <label className="text-xs text-muted-foreground">To location<div><LocationField value={xferTo} onChange={setXferTo} locations={locations.filter((l) => l.toLowerCase() !== (item.location ?? "").toLowerCase())} /></div></label>
              <label className="text-xs text-muted-foreground">Note<Input className="h-8 w-44" placeholder="optional" value={xferNote} onChange={(e) => setXferNote(e.target.value)} /></label>
              {/* A stock-transfer form must be uploaded before the transfer can be proposed. */}
              {xferProof ? (
                <span className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-xs">
                  <a href={`/api/transfer-uploads/view?path=${encodeURIComponent(xferProof.path)}&name=${encodeURIComponent(xferProof.name)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Eye className="h-3.5 w-3.5" /> {xferProof.name}
                  </a>
                  <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setXferProof(null)} aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : (
                <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-accent">
                  <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload transfer form"}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                </label>
              )}
              <Button size="sm" className="h-8" disabled={busy || !xferProof} onClick={transfer}>{busy ? "…" : "Propose transfer"}</Button>
              <span className="text-xs text-muted-foreground">from {item.location || "—"} · {fmt(item.available)} {item.unit} available · applies only after Warehouseman &amp; Purchaser both approve</span>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "label" && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
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
      {/* Pending double-handshake actions on this item — always shown so both
          parties can review, approve or reject them. */}
      {pending.length > 0 && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-amber-50/40 dark:bg-amber-950/10">
            <PendingStockActions pending={pending} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function InventoryManager({ items, canManage, canCreate = true, locations, showPrices, canEditPrices, pendingByItem = {} }: { items: Item[]; canManage: boolean; canCreate?: boolean; locations: string[]; showPrices: boolean; canEditPrices: boolean; pendingByItem?: Record<string, StockActionView[]> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState("");
  const [reorder, setReorder] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [sellPrice, setSellPrice] = useState("");
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
  // Quick filter: only items with no selling price set (price viewers only).
  const [needsPrice, setNeedsPrice] = useState(false);
  const needPriceCount = items.filter((it) => it.sellPrice <= 0).length;
  const q = query.trim().toLowerCase();
  const searched = q === ""
    ? items
    : items.filter((it) =>
        it.name.toLowerCase().includes(q) ||
        (it.sku ?? "").toLowerCase().includes(q) ||
        (it.category ?? "").toLowerCase().includes(q) ||
        (it.location ?? "").toLowerCase().includes(q),
      );
  const priceFiltered = needsPrice && showPrices ? searched.filter((it) => it.sellPrice <= 0) : searched;
  // Status drill-down from the Low / Out stock tiles (?status=low|out). Read from
  // the URL so clicking a tile updates the list live (the component stays mounted).
  const statusParam = searchParams.get("status");
  const statusFilter: "low" | "out" | null = statusParam === "low" || statusParam === "out" ? statusParam : null;
  const filtered = statusFilter ? priceFiltered.filter((it) => it.status === statusFilter) : priceFiltered;

  // Sort & group controls.
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [group, setGroup] = useState<GroupKey>("none");

  const statusRank = (s: Item["status"]) => (s === "ok" ? 0 : s === "low" ? 1 : 2);
  const sorted = useMemo(() => {
    const mul = dir === "asc" ? 1 : -1;
    const cmp = (a: Item, b: Item): number => {
      switch (sortKey) {
        case "quantity": return (a.quantity - b.quantity) * mul;
        case "available": return (a.available - b.available) * mul;
        case "reorderLevel": return (a.reorderLevel - b.reorderLevel) * mul;
        case "unitCost": return (a.unitCost - b.unitCost) * mul;
        case "sellPrice": return (a.sellPrice - b.sellPrice) * mul;
        case "value": return (a.value - b.value) * mul;
        case "status": return (statusRank(a.status) - statusRank(b.status)) * mul || a.name.localeCompare(b.name);
        case "location": return ((a.location ?? "").localeCompare(b.location ?? "") || a.name.localeCompare(b.name)) * mul;
        case "category": return ((a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name)) * mul;
        default: return a.name.localeCompare(b.name) * mul;
      }
    };
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, dir]);

  const groupValue = (it: Item): string => {
    switch (group) {
      case "location": return it.location || "—";
      case "category": return it.category || "—";
      case "status": return it.status === "ok" ? "OK" : it.status === "low" ? "Low" : "Out";
      default: return "";
    }
  };
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows: sorted }];
    const map = new Map<string, Item[]>();
    for (const it of sorted) { const k = groupValue(it); (map.get(k) ?? map.set(k, []).get(k)!).push(it); }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, group]);
  const cols = 8 + (showPrices ? 3 : 0) + (canManage || canEditPrices ? 1 : 0);
  // Hide the price-based sort options from viewers who can't see prices.
  const sortOptions = showPrices ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => o.key !== "unitCost" && o.key !== "sellPrice" && o.key !== "value");

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

  // Count duplicate items (same name) so we can offer a one-click merge — the
  // number of extra copies beyond the first of each name.
  const dupCount = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items) { const k = it.name.trim().toLowerCase(); seen.set(k, (seen.get(k) ?? 0) + 1); }
    let extra = 0;
    for (const c of seen.values()) if (c > 1) extra += c - 1;
    return extra;
  }, [items]);

  async function mergeDupes() {
    if (!window.confirm(`Merge ${dupCount} duplicate item${dupCount === 1 ? "" : "s"}? Items with the same name are combined into one (keeping the selling price / unit cost), and the extra copies are removed (recoverable by an admin).`)) return;
    setBusy(true); setErr(null);
    try {
      const { removed } = await mergeDuplicateStockItems();
      router.refresh();
      window.alert(`${removed} duplicate item${removed === 1 ? "" : "s"} merged.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function add() {
    if (name.trim() === "") { setErr("Enter an item name."); return; }
    setBusy(true); setErr(null);
    try {
      await createStockItem({
        name, unit, category: category || undefined, location: location || undefined,
        quantity: Number(qty) || 0, reorderLevel: Number(reorder) || 0, unitCost: Number(unitCost) || 0, sellPrice: Number(sellPrice) || 0,
      });
      setName(""); setCategory(""); setLocation(""); setQty(""); setReorder(""); setUnitCost(""); setSellPrice(""); setUnit("pcs"); setShowAdd(false);
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

      {canCreate && (
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
                {showPrices && <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Unit cost ₱" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />}
                {showPrices && <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Sell price ₱" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />}
                <Button size="sm" className="h-8" disabled={busy} onClick={add}>{busy ? "Saving…" : "Add item"}</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setShowAdd(true)}>+ Add stock item</Button>
              <BulkImport />
              {dupCount > 0 && (
                <Button size="sm" variant="outline" className="text-amber-700 hover:text-amber-700" disabled={busy} onClick={mergeDupes}>
                  {busy ? "…" : `Merge duplicates (${dupCount})`}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Text search + sort / group controls. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search items by name, SKU, category or location…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {q !== "" && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {GROUP_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Sort by
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {sortOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2.5 text-sm hover:bg-accent" title={dir === "asc" ? "Ascending" : "Descending"}>
          {dir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
        {showPrices && needPriceCount > 0 && (
          <button type="button" onClick={() => setNeedsPrice((v) => !v)}
            className={`inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm ${needsPrice ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40" : "bg-background hover:bg-accent"}`}
            title="Show only items with no selling price set">
            {needsPrice ? "✓ " : ""}Needs selling price ({needPriceCount})
          </button>
        )}
        {/* Active status drill-down (from a Low / Out stock tile) — click to clear. */}
        {statusFilter && (
          <button type="button" onClick={() => router.push("/inventory#inv-items")}
            className={`inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm ${
              statusFilter === "out" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40"
            }`}
            title="Clear the status filter">
            {statusFilter === "out" ? "Out of stock" : "Low stock"} ({filtered.length}) <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No stock items yet.</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {statusFilter ? `No ${statusFilter === "out" ? "out-of-stock" : "low-stock"} items.` : needsPrice && q === "" ? "Every item has a selling price set. 🎉" : `No items match “${query}”.`}
        </p>
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
                {showPrices && <TableHead className="text-right">Unit cost</TableHead>}
                {showPrices && <TableHead className="text-right">Sell price</TableHead>}
                {showPrices && <TableHead className="text-right">Value</TableHead>}
                <TableHead>Status</TableHead>
                {(canManage || canEditPrices) && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.key || "all"}>
                  {group !== "none" && (
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={cols} className="py-1.5">
                        <span className="text-sm font-semibold">{g.key || "—"}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{g.rows.length} item{g.rows.length === 1 ? "" : "s"}{showPrices ? ` · ${peso(g.rows.reduce((a, r) => a + r.value, 0))}` : ""}</span>
                      </TableCell>
                    </TableRow>
                  )}
                  {g.rows.map((it) => <StockRow key={it.id} item={it} canManage={canManage} showPrices={showPrices} canEditPrices={canEditPrices} locations={locations} scanTarget={scanTarget} scanNonce={scanNonce} pending={pendingByItem[it.id] ?? []} />)}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
