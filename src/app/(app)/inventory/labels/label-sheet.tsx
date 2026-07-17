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
  name: string;
  location: string | null;
  unit: string;
}

function Label({ item }: { item: LabelItem }) {
  const bar = useMemo(() => code128Svg(item.code, { moduleWidth: 1.8, height: 46 }), [item.code]);
  const qr = useMemo(() => qrSvg(item.code, { scale: 3 }), [item.code]);
  return (
    <>
      <div className="text-sm font-semibold leading-tight">{item.name}</div>
      <div className="text-xs text-muted-foreground">
        {[item.sku ? `SKU ${item.sku}` : null, item.location ? `Loc ${item.location}` : null, item.unit].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-1 flex items-center justify-center gap-3">
        {/* eslint-disable-next-line react/no-danger */}
        <div className="overflow-hidden" dangerouslySetInnerHTML={{ __html: bar }} />
        {/* eslint-disable-next-line react/no-danger */}
        <div dangerouslySetInnerHTML={{ __html: qr }} />
      </div>
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
          <p className="text-sm text-muted-foreground">Code 128 + QR — scannable by any barcode scanner. Tick items to print a subset, or print all.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory" className="rounded-md border px-3 py-2 text-sm hover:bg-accent">← Inventory</Link>
          <Button size="sm" variant="outline" className="h-9" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Select all</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button size="sm" className="h-9" disabled={selected.size === 0} onClick={printSelected}>Print selected ({selected.size})</Button>
          <Button size="sm" variant="outline" className="h-9" onClick={printAll}>Print all</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((i) => {
          const hideOnPrint = onlySelected && !selected.has(i.id);
          return (
            <label
              key={i.id}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border p-3 text-center break-inside-avoid ${selected.has(i.id) ? "ring-2 ring-primary" : ""} ${hideOnPrint ? "print:hidden" : ""}`}
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
