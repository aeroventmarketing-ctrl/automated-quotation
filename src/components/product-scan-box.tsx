"use client";

import { useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { matchScannedProduct, type ScanProduct } from "@/lib/product-scan";

/**
 * Scan a product barcode → resolve it to a catalogue product and hand it to the
 * caller (which typically appends a new line). Keeps focus so the operator can
 * scan several items in a row. Unknown codes show a "no match" message.
 */
export function ProductScanBox({
  products,
  onFound,
  className,
  placeholder = "Scan product barcode…",
}: {
  products: ScanProduct[];
  onFound: (p: ScanProduct) => void;
  className?: string;
  placeholder?: string;
}) {
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const found = matchScannedProduct(products, code);
    if (!found) {
      setErr(true);
      setMsg(`No product matches “${code}”.`);
      return;
    }
    setErr(false);
    setMsg(`Added: ${found.name}`);
    onFound(found);
    ref.current?.focus();
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          className="h-9 w-56 pl-8"
          placeholder={placeholder}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      {msg && <span className={`text-xs ${err ? "text-destructive" : "text-emerald-600"}`}>{msg}</span>}
    </div>
  );
}
