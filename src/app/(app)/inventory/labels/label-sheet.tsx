"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { code128Svg } from "@/lib/code128";
import { qrSvg } from "@/lib/qr";

export interface LabelItem {
  id: string;
  code: string; // sku ?? id
  sku: string | null;
  barcode?: string | null; // external supplier GTIN, if any (inventory items only)
  name: string;
  location: string | null;
  unit: string;
}

function Label({ item }: { item: LabelItem }) {
  const bar = useMemo(() => code128Svg(item.code, { moduleWidth: 1.8, height: 46 }), [item.code]);
  const qr = useMemo(() => qrSvg(item.code, { scale: 3 }), [item.code]);
  // A second Code 128 for the external supplier barcode (GTIN), when present, so
  // the printed label carries both our Item Code and the supplier's barcode.
  const extBar = useMemo(
    () => (item.barcode ? code128Svg(item.barcode, { moduleWidth: 1.6, height: 34 }) : null),
    [item.barcode],
  );
  return (
    <>
      <div className="text-sm font-semibold leading-tight">{item.name}</div>
      <div className="text-xs text-muted-foreground">
        {[item.sku ? `SKU ${item.sku}` : null, item.location ? `Loc ${item.location}` : null, item.unit].filter(Boolean).join(" · ")}
      </div>
      {/* Item Code (SKU) — Code 128 above, QR beneath.
          These SVGs are generated at their NATURAL size: a Code 128 of an
          8-character item code is ~143 modules ≈ 257px at moduleWidth 1.8, which
          is already wider than a label card in a 4-up grid. Side by side with the
          QR they overflowed the card and printed across the neighbouring label.
          So: stacked, and each SVG is scaled to its container
          (`[&>svg]:w-full [&>svg]:h-auto` works because both carry a viewBox).
          Stacking is not cosmetic — it gives the barcode the FULL card width,
          which is what keeps its bars thick enough to scan. Sharing the row with
          the QR would leave it about 160px, ~0.30mm per module, at the ragged
          edge of what a scanner reads. */}
      {/* The scaling class sits on the SAME element the SVG is injected into —
          `[&>svg]` is a direct-child selector, so a wrapper around the wrapper
          silently matches nothing and the SVG keeps its natural width. */}
      {/* eslint-disable-next-line react/no-danger */}
      <div className="mt-1 w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: bar }} />
      {/* The QR is capped rather than stretched — a QR reads fine small, and a
          full-width one would waste the label. */}
      {/* eslint-disable-next-line react/no-danger */}
      <div className="w-20 max-w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
      {extBar && (
        <div className="mt-1 flex w-full flex-col items-center">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Barcode {item.barcode}</div>
          {/* eslint-disable-next-line react/no-danger */}
          <div className="w-full [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: extBar }} />
        </div>
      )}
    </>
  );
}

export function LabelSheet({ items, initialSelected }: { items: LabelItem[]; initialSelected: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected.filter((id) => items.some((i) => i.id === id))));
  const [onlySelected, setOnlySelected] = useState(false);
  const [printSignal, setPrintSignal] = useState(0);

  useEffect(() => {
    if (printSignal > 0) window.print();
  }, [printSignal]);

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function printAll() { setOnlySelected(false); setPrintSignal((s) => s + 1); }
  function printSelected() { if (selected.size === 0) return; setOnlySelected(true); setPrintSignal((s) => s + 1); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Stock labels</h1>
          <p className="text-sm text-muted-foreground">Code 128 + QR of the Item Code, plus the supplier barcode when set — scannable by any barcode scanner. Tick items to print a subset, or print all.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory" className="rounded-md border px-3 py-2 text-sm hover:bg-accent">← Inventory</Link>
          <Button size="sm" variant="outline" className="h-9" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Select all</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button size="sm" className="h-9" disabled={selected.size === 0} onClick={printSelected}>Print selected ({selected.size})</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={printAll}>Print all</Button>
        </div>
      </div>

      {/* Three-up on paper, not four. A printed A4 column at 4-up is ~180px wide,
          which squeezes a Code 128 to ~0.33mm per module — readable, but with no
          margin for a tired printer or a scuffed label. Three columns give ~0.44mm
          and cost only a little paper. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 print:grid-cols-3">
        {items.map((i) => {
          const hideOnPrint = onlySelected && !selected.has(i.id);
          return (
            <label
              key={i.id}
              // `overflow-hidden` + `min-w-0`: belt and braces, so nothing can
              // ever bleed into the neighbouring label again.
              className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 overflow-hidden rounded-md border p-3 text-center break-inside-avoid ${selected.has(i.id) ? "ring-2 ring-primary" : ""} ${hideOnPrint ? "print:hidden" : ""}`}
            >
              <input type="checkbox" className="self-start accent-[#ED1C24] print:hidden" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
              <Label item={i} />
            </label>
          );
        })}
      </div>
    </div>
  );
}
