"use client";

import { useEffect, useRef, useState } from "react";
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
import { createProduct, updateProduct, deleteProduct, assignMissingProductSkus } from "./actions";
import { BulkImport } from "./bulk-import";
import { ProductScanBox } from "@/components/product-scan-box";
import type { ScanProduct } from "@/lib/product-scan";

const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

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

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v.company} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
              {v.company}{v.code ? ` · ${v.code}` : ""}{v.price ? ` · ${peso(v.price)}` : ""}
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

function ProductRowView({ product, canManage, suppliers, scanTarget, scanNonce }: { product: ProductRow; canManage: boolean; suppliers: Supplier[]; scanTarget: string | null; scanNonce: number }) {
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
      <TableRow ref={rowRef} className={flash ? "bg-primary/10 transition-colors" : undefined}>
        <TableCell>
          <div className="font-medium">{product.name}</div>
          <div className="text-xs text-muted-foreground">{[product.sku ? `SKU ${product.sku}` : null, product.category].filter(Boolean).join(" · ")}</div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{product.unit}</TableCell>
        <TableCell className="text-sm">
          {product.suppliers.length === 0 ? <span className="text-muted-foreground">No supplier</span> : (
            <div className="flex flex-wrap gap-1">
              {product.suppliers.map((s) => (
                <Badge key={s.company} variant="secondary" className="font-normal">{s.company}{s.price ? ` · ${peso(s.price)}` : ""}</Badge>
              ))}
            </div>
          )}
        </TableCell>
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
          <TableCell colSpan={canManage ? 4 : 3} className="bg-muted/30">
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
          <TableCell colSpan={canManage ? 4 : 3} className="bg-muted/30">
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

export function ProductManager({ products, suppliers, canManage }: { products: ProductRow[]; suppliers: Supplier[]; canManage: boolean }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
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
              <Link href="/products/labels" className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">Labels</Link>
            </div>
          )}
        </div>
      )}

      {/* Text search across name / SKU / category / supplier. */}
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-9 pl-8" placeholder="Search products by name, SKU, category or supplier…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {q !== "" && (
          <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

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
                <TableHead>Product</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Suppliers</TableHead>
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => <ProductRowView key={p.id} product={p} canManage={canManage} suppliers={suppliers} scanTarget={scanTarget} scanNonce={scanNonce} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
