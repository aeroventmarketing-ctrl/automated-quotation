"use client";

import { useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { matchScannedProduct, type ScanProduct } from "@/lib/product-scan";

export interface ScanMode {
  value: string;
  /** e.g. "Scan → add line" */
  label: string;
  /** Show the Qty field for this mode. */
  needsQty?: boolean;
}

/**
 * Inventory-style barcode scan control: a scan input, a mode dropdown, and an
 * optional Qty box. A handheld scanner "types" the product SKU + Enter; we
 * resolve it to a catalogue product and hand it to the caller along with the
 * chosen mode and quantity. The caller decides what each mode does (add a line,
 * jump to an existing one, …) and returns the message to show. Keeps focus so
 * the operator can scan several items in a row.
 */
export function ProductScanBox({
  products,
  modes,
  onScan,
  defaultQty = "1",
  autoFocus = false,
  className,
}: {
  products: ScanProduct[];
  modes: ScanMode[];
  onScan: (a: { mode: string; product: ScanProduct; qty: number }) => { ok: boolean; message: string };
  defaultQty?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [scan, setScan] = useState("");
  const [mode, setMode] = useState(modes[0]?.value ?? "");
  const [qty, setQty] = useState(defaultQty);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const current = modes.find((m) => m.value === mode) ?? modes[0];

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const product = matchScannedProduct(products, code);
    if (!product) {
      setErr(true);
      setMsg(`No product matches “${code}”.`);
      return;
    }
    const q = current?.needsQty ? Number(qty) : 0;
    if (current?.needsQty && !(q > 0)) {
      setErr(true);
      setMsg("Enter a quantity first.");
      return;
    }
    const res = onScan({ mode, product, qty: q });
    setErr(!res.ok);
    setMsg(res.message);
    ref.current?.focus();
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          className="h-9 w-56 pl-8"
          placeholder="Scan product barcode…"
          value={scan}
          autoFocus={autoFocus}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      {modes.length > 0 && (
        <select
          value={mode}
          onChange={(e) => { setMode(e.target.value); ref.current?.focus(); }}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      )}
      {current?.needsQty && (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Qty
          <Input className="h-9 w-20" type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
      )}
      {msg && <span className={`text-xs ${err ? "text-destructive" : "text-emerald-600"}`}>{msg}</span>}
    </div>
  );
}

/** The add + jump modes shared by the build-a-list forms (requisition, MRF, PO). */
export const ADD_JUMP_MODES = (addLabel: string): ScanMode[] => [
  { value: "add", label: `Scan → ${addLabel}`, needsQty: true },
  { value: "jump", label: "Scan → jump to item" },
];
