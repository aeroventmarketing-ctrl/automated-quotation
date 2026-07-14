"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { createStockItem, adjustStock } from "./actions";

interface Item {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  quantity: number;
  reorderLevel: number;
  status: "ok" | "low" | "out";
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

function StockRow({ item, canManage }: { item: Item; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"RECEIPT" | "ISSUE" | "ADJUSTMENT">("RECEIPT");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function apply() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0) { setErr("Enter a quantity."); return; }
    setBusy(true); setErr(null);
    try {
      await adjustStock({ stockItemId: item.id, kind, qty: n, reason });
      setOpen(false); setQty(""); setReason("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="font-medium">{item.name}</div>
          {item.category && <div className="text-xs text-muted-foreground">{item.category}</div>}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{item.unit}</TableCell>
        <TableCell className="text-right tabular-nums font-medium">{fmt(item.quantity)}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(item.reorderLevel)}</TableCell>
        <TableCell>
          {item.status === "out" ? <Badge variant="destructive">Out</Badge>
            : item.status === "low" ? <Badge variant="warning">Low</Badge>
            : <Badge variant="success">OK</Badge>}
        </TableCell>
        {canManage && (
          <TableCell className="text-right">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen((o) => !o)}>
              {open ? "Close" : "Adjust"}
            </Button>
          </TableCell>
        )}
      </TableRow>
      {open && canManage && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
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
    </>
  );
}

export function InventoryManager({ items, canManage }: { items: Item[]; canManage: boolean }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState("");
  const [reorder, setReorder] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (name.trim() === "") { setErr("Enter an item name."); return; }
    setBusy(true); setErr(null);
    try {
      await createStockItem({
        name, unit, category: category || undefined,
        quantity: Number(qty) || 0, reorderLevel: Number(reorder) || 0,
      });
      setName(""); setCategory(""); setQty(""); setReorder(""); setUnit("pcs"); setShowAdd(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div>
          {showAdd ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">New stock item</div>
              <div className="flex flex-wrap items-end gap-2">
                <Input className="h-8 w-56" placeholder="Name (e.g. GI sheet 24ga)" value={name} onChange={(e) => setName(e.target.value)} />
                <Input className="h-8 w-24" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                <Input className="h-8 w-40" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
                <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Opening qty" value={qty} onChange={(e) => setQty(e.target.value)} />
                <Input className="h-8 w-28" type="number" step="any" min={0} placeholder="Reorder at" value={reorder} onChange={(e) => setReorder(e.target.value)} />
                <Button size="sm" className="h-8" disabled={busy} onClick={add}>{busy ? "Saving…" : "Add item"}</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
              {err && <p className="text-xs text-destructive">{err}</p>}
            </div>
          ) : (
            <Button size="sm" onClick={() => setShowAdd(true)}>+ Add stock item</Button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No stock items yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => <StockRow key={it.id} item={it} canManage={canManage} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
