"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { code128Svg } from "@/lib/code128";
import { qrSvg } from "@/lib/qr";
import type { Supplier } from "@/lib/suppliers";
import type { ProductSupplierLink } from "@/lib/products";
import type { ProductRow } from "@/lib/product-catalog";
import { createProduct, updateProduct, deleteProduct, assignMissingProductSkus, removeUnsourcedProducts, deleteProducts, clearAllProducts, setProductOfficeResaleAction } from "./actions";
import { BulkImport } from "./bulk-import";
import { ProductScanBox } from "@/components/product-scan-box";
import type { ScanProduct } from "@/lib/product-scan";

const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function triggerDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

type SortKey = "name" | "sku" | "unit" | "category" | "supplier" | "price";
type GroupKey = "none" | "category" | "supplier" | "unit";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "sku", label: "SKU" },
  { key: "unit", label: "Unit" },
  { key: "category", label: "Category" },
  { key: "supplier", label: "Supplier" },
  { key: "price", label: "Price" },
];
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "category", label: "Category" },
  { key: "supplier", label: "Supplier" },
  { key: "unit", label: "Unit" },
];
/** First supplier company on a product (for sort/group), or "" / "No supplier". */
const primarySupplier = (p: ProductRow) => p.suppliers[0]?.company ?? "";
/** Lowest defined supplier price on a product, or 0 when none priced. */
const primaryPrice = (p: ProductRow) => {
  const prices = p.suppliers.map((s) => s.price).filter((n): n is number => typeof n === "number" && n > 0);
  return prices.length ? Math.min(...prices) : 0;
};
/** A product with neither a named supplier nor any price (old auto-save leftover). */
const isUnsourced = (p: ProductRow) =>
  !p.suppliers.some((s) => s.company && s.company.trim() !== "") &&
  !p.suppliers.some((s) => typeof s.price === "number" && s.price > 0);

/** Add/remove the suppliers a product can be bought from, each with code + price. */
function SupplierEditor({ value, onChange, suppliers }: { value: ProductSupplierLink[]; onChange: (v: ProductSupplierLink[]) => void; suppliers: Supplier[] }) {
  const [pick, setPick] = useState("");
  const [code, setCode] = useState("");
  const [price, setPrice] = useState("");

  function add() {
    const s = suppliers.find((x) => x.id === pick);
    const company = s?.company ?? pick.trim();
    if (!company) return;
    if (value.some((v) => v.company.toLowerCase() === company.toLowerCase())) { setPick(""); return; }
    onChange([...value, { supplierId: s?.id ?? "", company, code: code.trim() || undefined, price: Number(price) > 0 ? Number(price) : undefined }]);
    setPick(""); setCode(""); setPrice("");
  }
  function remove(company: string) {
    onChange(value.filter((v) => v.company !== company));
  }
  /** Edit one supplier's unit price in place (blank clears it). */
  function setPriceFor(company: string, raw: string) {
    const n = Number(raw);
    onChange(value.map((v) => (v.company === company ? { ...v, price: raw.trim() && n > 0 ? n : undefined } : v)));
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v.company} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
              {v.company}{v.code ? ` · ${v.code}` : ""}
              {/* The price is editable in place — a multi-supplier import gives
                  every supplier the row's price, so correcting one shouldn't
                  mean removing and re-adding the supplier. */}
              <span className="inline-flex items-center text-muted-foreground">
                ₱
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={v.price ?? ""}
                  placeholder="—"
                  aria-label={`Unit price for ${v.company}`}
                  onChange={(e) => setPriceFor(v.company, e.target.value)}
                  className="w-16 bg-transparent px-0.5 text-xs tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60 focus:underline"
                />
              </span>
              <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove(v.company)} aria-label={`Remove ${v.company}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="h-8 w-44 rounded-md border bg-background px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— add supplier —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company}</option>)}
        </select>
        <Input className="h-8 w-28" placeholder="Supplier code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="Price ₱" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Button size="sm" variant="outline" className="h-8" disabled={!pick} onClick={add}>Add</Button>
      </div>
    </div>
  );
}

function ProductRowView({ product, canManage, showPrices, showSuppliers, suppliers, scanTarget, scanNonce, selectable, selected, onToggle, colSpan, officeResale }: { product: ProductRow; canManage: boolean; showPrices: boolean; showSuppliers: boolean; suppliers: Supplier[]; scanTarget: string | null; scanNonce: number; selectable: boolean; selected: boolean; onToggle: () => void; colSpan: number; officeResale: boolean }) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "edit" | "label">("none");
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [flash, setFlash] = useState(false);
  const [name, setName] = useState(product.name);
  const [unit, setUnit] = useState(product.unit);
  const [category, setCategory] = useState(product.category ?? "");
  const [note, setNote] = useState(product.note ?? "");
  const [sups, setSups] = useState<ProductSupplierLink[]>(product.suppliers);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resale, setResale] = useState(officeResale);
  const [resaleBusy, setResaleBusy] = useState(false);
  async function toggleResale() {
    setResaleBusy(true); setErr(null);
    try { setResale(await setProductOfficeResaleAction(product.id, !resale)); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setResaleBusy(false); }
  }

  // A scan that matches this product opens its Label panel and scrolls to it.
  useEffect(() => {
    if (scanTarget && scanTarget === product.id) {
      setPanel("label");
      setFlash(true);
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanNonce]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); setPanel("none"); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <TableRow ref={rowRef} className={flash ? "bg-primary/10 transition-colors" : selected ? "bg-primary/5" : undefined}>
        {selectable && (
          <TableCell className="w-8 align-top">
            <input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer" checked={selected} onChange={onToggle} aria-label={`Select ${product.name}`} />
          </TableCell>
        )}
        <TableCell>
          <div className="font-medium">
            {product.name}
            {resale && <Badge variant="secondary" className="ml-2 font-normal text-violet-700">Office/resale</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">{[product.sku ? `SKU ${product.sku}` : null, product.category].filter(Boolean).join(" · ")}</div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{product.unit}</TableCell>
        {showSuppliers && (
          <TableCell className="text-sm">
            {product.suppliers.length === 0 ? <span className="text-muted-foreground">No supplier</span> : (
              <div className="flex flex-wrap gap-1">
                {product.suppliers.map((s) => (
                  <Badge key={s.company} variant="secondary" className="font-normal">{s.company}{showPrices && s.price ? ` · ${peso(s.price)}` : ""}</Badge>
                ))}
              </div>
            )}
          </TableCell>
        )}
        {canManage && (
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "label" ? "none" : "label"))}>Label</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPanel((p) => (p === "edit" ? "none" : "edit"))}>Edit</Button>
            </div>
          </TableCell>
        )}
      </TableRow>
      {panel === "edit" && canManage && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="space-y-2 py-1">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground">Name<Input className="h-8 w-56" value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">Unit<Input className="h-8 w-24" value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">Category<Input className="h-8 w-40" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
                <label className="text-xs text-muted-foreground">Note<Input className="h-8 w-48" value={note} onChange={(e) => setNote(e.target.value)} /></label>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Suppliers</div>
                <SupplierEditor value={sups} onChange={setSups} suppliers={suppliers} />
              </div>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={resale} disabled={resaleBusy} onChange={toggleResale} />
                <span>
                  <span className="font-medium">Office / resale</span> — a bought &amp; resold finished good.
                  Its sales are booked entirely to <b>Office</b> in the Departmental P&amp;L, never to a production department.
                </span>
              </label>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" disabled={busy} onClick={() => run(() => updateProduct({ id: product.id, name, unit, category, note, suppliers: sups }))}>{busy ? "…" : "Save"}</Button>
                <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => run(() => deleteProduct(product.id))}>Delete</Button>
                {err && <span className="text-xs text-destructive">{err}</span>}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
      {panel === "label" && (
        <TableRow>
          <TableCell colSpan={colSpan} className="bg-muted/30">
            <div className="flex flex-col items-start gap-1 py-1">
              <div className="text-sm font-medium">{product.name}{product.sku ? ` · SKU ${product.sku}` : ""}</div>
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line react/no-danger */}
                <div dangerouslySetInnerHTML={{ __html: code128Svg(product.sku ?? product.id, { moduleWidth: 2, height: 48 }) }} />
                {/* eslint-disable-next-line react/no-danger */}
                <div dangerouslySetInnerHTML={{ __html: qrSvg(product.sku ?? product.id, { scale: 3 }) }} />
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/products/labels?ids=${product.id}`} className="text-xs font-medium text-primary hover:underline">Print this label →</Link>
                <span className="text-[10px] text-muted-foreground">Code 128 + QR · any barcode scanner.</span>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function ProductManager({ products, suppliers, canManage, admin = false, showPrices, showSuppliers = true, resaleIds = [] }: { products: ProductRow[]; suppliers: Supplier[]; canManage: boolean; admin?: boolean; showPrices: boolean; showSuppliers?: boolean; resaleIds?: string[] }) {
  const router = useRouter();
  const resaleSet = useMemo(() => new Set(resaleIds), [resaleIds]);
  const [showAdd, setShowAdd] = useState(false);
  // Multi-select for bulk delete (managers only).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [sups, setSups] = useState<ProductSupplierLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [scanTarget, setScanTarget] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);

  // Text search: filter by name, SKU, category or supplier company.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q === ""
    ? products
    : products.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        p.suppliers.some((s) => s.company.toLowerCase().includes(q)),
      );

  // Sort & group controls.
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [group, setGroup] = useState<GroupKey>("none");

  const sorted = useMemo(() => {
    const mul = dir === "asc" ? 1 : -1;
    const cmp = (a: ProductRow, b: ProductRow): number => {
      switch (sortKey) {
        case "sku": return ((a.sku ?? "").localeCompare(b.sku ?? "") || a.name.localeCompare(b.name)) * mul;
        case "unit": return ((a.unit ?? "").localeCompare(b.unit ?? "") || a.name.localeCompare(b.name)) * mul;
        case "category": return ((a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name)) * mul;
        case "supplier": return (primarySupplier(a).localeCompare(primarySupplier(b)) || a.name.localeCompare(b.name)) * mul;
        case "price": return (primaryPrice(a) - primaryPrice(b) || a.name.localeCompare(b.name)) * mul;
        default: return a.name.localeCompare(b.name) * mul;
      }
    };
    return [...filtered].sort(cmp);
  }, [filtered, sortKey, dir]);

  const groupValue = (p: ProductRow): string => {
    switch (group) {
      case "category": return p.category || "—";
      case "supplier": return primarySupplier(p) || "No supplier";
      case "unit": return p.unit || "—";
      default: return "";
    }
  };
  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", rows: sorted }];
    const map = new Map<string, ProductRow[]>();
    for (const p of sorted) { const k = groupValue(p); (map.get(k) ?? map.set(k, []).get(k)!).push(p); }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, group]);
  const selectable = canManage;
  const cols = (canManage ? 4 : 3) - (showSuppliers ? 0 : 1) + (selectable ? 1 : 0);

  function handleScan({ product }: { product: ScanProduct }) {
    setScanTarget(product.id); setScanNonce((n) => n + 1);
    return { ok: true, message: `Found: ${product.name}` };
  }

  async function add() {
    if (name.trim() === "") { setErr("Enter a product name."); return; }
    setBusy(true); setErr(null);
    try {
      await createProduct({ name, unit, category, note, suppliers: sups });
      setName(""); setUnit("pcs"); setCategory(""); setNote(""); setSups([]); setShowAdd(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  const missing = products.filter((p) => !p.sku).length;
  const unsourced = products.filter(isUnsourced).length;
  // Hide the price- and supplier-based sort options from viewers who can't see them.
  const sortOptions = SORT_OPTIONS.filter((o) => (showPrices || o.key !== "price") && (showSuppliers || o.key !== "supplier"));
  const groupOptions = GROUP_OPTIONS.filter((o) => showSuppliers || o.key !== "supplier");

  // Only offer to select the products currently visible (after search/filter).
  const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered]);
  const selectedVisible = filteredIds.filter((id) => selected.has(id));
  const allVisibleSelected = filteredIds.length > 0 && selectedVisible.length === filteredIds.length;
  function toggleAllVisible() {
    setSelected((s) => {
      const n = new Set(s);
      if (allVisibleSelected) filteredIds.forEach((id) => n.delete(id));
      else filteredIds.forEach((id) => n.add(id));
      return n;
    });
  }
  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected product${ids.length === 1 ? "" : "s"}? They'll be removed from the list (recoverable by an admin).`)) return;
    setBusy(true); setErr(null);
    try {
      const { removed } = await deleteProducts(ids);
      setSelected(new Set());
      router.refresh();
      window.alert(`${removed} product${removed === 1 ? "" : "s"} removed.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function clearAll() {
    if (!window.confirm(`Clear ALL ${products.length} products so you can import a fresh file? They'll be removed from the list (recoverable by an admin).`)) return;
    if (!window.confirm("This removes every product on the list. Continue?")) return;
    setBusy(true); setErr(null);
    try {
      const { removed } = await clearAllProducts();
      setSelected(new Set());
      router.refresh();
      window.alert(`${removed} product${removed === 1 ? "" : "s"} removed. You can now import a fresh file.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  // Export the current (search-filtered, sorted) list to CSV / Excel.
  function exportRows() {
    const headers = ["Name", "SKU", "Unit", "Category", "Note", "Suppliers", ...(showPrices ? ["Lowest price"] : [])];
    const rows = sorted.map((p) => [
      p.name, p.sku ?? "", p.unit, p.category ?? "", p.note ?? "",
      p.suppliers.map((s) => `${s.company}${s.code ? ` (${s.code})` : ""}${showPrices && s.price ? ` ₱${s.price}` : ""}`).join("; "),
      ...(showPrices ? [primaryPrice(p) ? String(primaryPrice(p)) : ""] : []),
    ]);
    return { headers, rows };
  }
  function exportCsv() {
    const { headers, rows } = exportRows();
    const csv = [headers, ...rows].map((r) => r.map((c) => csvEscape(String(c ?? ""))).join(",")).join("\r\n");
    triggerDownload("products.csv", new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  }
  async function exportXlsx() {
    setBusy(true); setErr(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Products");
      const { headers, rows } = exportRows();
      ws.addRow(headers); ws.getRow(1).font = { bold: true };
      rows.forEach((r) => ws.addRow(r));
      ws.columns.forEach((c) => (c.width = 24));
      const buf = await wb.xlsx.writeBuffer();
      triggerDownload("products.xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    } catch (e) { setErr(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(false); }
  }

  async function cleanupUnsourced() {
    if (!window.confirm(`Remove ${unsourced} product${unsourced === 1 ? "" : "s"} that have no supplier and no price? They'll be removed from the list (recoverable by an admin).`)) return;
    setBusy(true); setErr(null);
    try {
      const { removed } = await removeUnsourcedProducts();
      router.refresh();
      window.alert(`${removed} item${removed === 1 ? "" : "s"} removed.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {/* Scan box: a scanner types the SKU + Enter → jump to the product. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
        <ProductScanBox
          products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))}
          modes={[{ value: "find", label: "Scan → jump to item" }]}
          onScan={handleScan}
        />
        {canManage && missing > 0 && (
          <Button size="sm" variant="outline" className="ml-auto h-9 text-xs" disabled={busy}
            onClick={async () => { setBusy(true); try { await assignMissingProductSkus(); router.refresh(); } finally { setBusy(false); } }}>
            {busy ? "…" : `Generate SKUs (${missing})`}
          </Button>
        )}
      </div>

      {canManage && (
        <div>
          {showAdd ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">New product</div>
              <div className="flex flex-wrap items-end gap-2">
                <Input className="h-8 w-56" placeholder="Name (e.g. GI sheet 24ga)" value={name} onChange={(e) => setName(e.target.value)} />
                <Input className="h-8 w-24" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                <Input className="h-8 w-40" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
                <Input className="h-8 w-48" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Suppliers</div>
                <SupplierEditor value={sups} onChange={setSups} suppliers={suppliers} />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="h-8" disabled={busy} onClick={add}>{busy ? "Saving…" : "Add product"}</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
                {err && <span className="text-xs text-destructive">{err}</span>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setShowAdd(true)}>+ Add product</Button>
              <BulkImport />
              {products.length > 0 && (
                <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={exportXlsx}>Download Excel</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={exportCsv}>Download CSV</Button>
                </>
              )}
              <Link href="/products/labels" className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">Labels</Link>
              {unsourced > 0 && (
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={cleanupUnsourced}>
                  {busy ? "…" : `Remove no-supplier items (${unsourced})`}
                </Button>
              )}
              {admin && products.length > 0 && (
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={clearAll}>
                  {busy ? "…" : `Clear all (${products.length})`}
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
          <Input className="h-9 pl-8" placeholder="Search products by name, SKU, category or supplier…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {q !== "" && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Group by
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
            {groupOptions.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
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
        {/* Download stays available to view-only roles (who don't get the action row above). */}
        {!canManage && products.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={exportXlsx}>Download Excel</Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={exportCsv}>Download CSV</Button>
          </div>
        )}
      </div>

      {/* Bulk selection bar — appears once one or more products are ticked. */}
      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={deleteSelected}>
            {busy ? "…" : "Delete selected"}
          </Button>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {products.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No products yet.</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No products match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="overflow-x-auto">
          {q !== "" && <p className="mb-1 text-xs text-muted-foreground">{filtered.length} of {products.length} products</p>}
          <Table>
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead className="w-8">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all" title="Select all shown" />
                  </TableHead>
                )}
                <TableHead>Product</TableHead>
                <TableHead>Unit</TableHead>
                {showSuppliers && <TableHead>Suppliers</TableHead>}
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.key || "all"}>
                  {group !== "none" && (
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={cols} className="py-1.5">
                        <span className="text-sm font-semibold">{g.key || "—"}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{g.rows.length} product{g.rows.length === 1 ? "" : "s"}</span>
                      </TableCell>
                    </TableRow>
                  )}
                  {g.rows.map((p) => <ProductRowView key={p.id} product={p} canManage={canManage} showPrices={showPrices} showSuppliers={showSuppliers} suppliers={suppliers} scanTarget={scanTarget} scanNonce={scanNonce} selectable={selectable} selected={selected.has(p.id)} onToggle={() => toggleOne(p.id)} colSpan={cols} officeResale={resaleSet.has(p.id)} />)}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
