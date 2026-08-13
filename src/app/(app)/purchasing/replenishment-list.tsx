"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { receivePurchaseRequest } from "../orders/actions";

/** A replenishment ready to receive into stock (its receive step is available). */
export interface ReplenScanRow {
  id: string;
  stockItemId: string;
  sku: string | null;
  unit: string;
  items: string[];
}

/**
 * Barcode "scan to receive" quick box for replenishment (stock top-up) requests
 * that have reached the receive step. Kept as a fast path alongside the full
 * purchasing chain (which the replenishments now render through) — scan the SKU,
 * enter a qty, and it posts straight into the matched stock item.
 */
export function ReplenishmentScanBar({ rows }: { rows: ReplenScanRow[] }) {
  const router = useRouter();
  const [scan, setScan] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  if (rows.length === 0) return null;

  async function onScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const row = rows.find((r) => r.sku === code) ?? rows.find((r) => r.stockItemId === code);
    if (!row) { setScanErr(true); setScanMsg(`No request ready to receive matches “${code}”.`); return; }
    const q = Number(scanQty);
    if (!(q > 0)) { setScanErr(true); setScanMsg("Enter a quantity."); return; }
    try {
      await receivePurchaseRequest(row.id, [{ stockItemId: row.stockItemId, qty: q }]);
      setScanErr(false); setScanMsg(`Received ${q} ${row.unit} · ${row.items.join(", ")}`);
      router.refresh();
    } catch (e2) {
      setScanErr(true); setScanMsg(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      scanRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2">
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={scanRef} className="h-9 w-56 pl-8" placeholder="Scan to receive…" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} />
      </div>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">Qty<Input className="h-9 w-20" type="number" step="any" min={0} value={scanQty} onChange={(e) => setScanQty(e.target.value)} /></label>
      {scanMsg && <span className={`text-xs ${scanErr ? "text-destructive" : "text-emerald-600"}`}>{scanMsg}</span>}
    </div>
  );
}
