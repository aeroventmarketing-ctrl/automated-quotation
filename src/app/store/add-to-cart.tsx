"use client";

import { useState } from "react";
import { addToCart } from "./cart-store";
import { openCartPanel, showToast } from "./ui-store";
import { MAX_LINE_QTY } from "@/lib/store-cart";
import { peso } from "@/lib/store-product";

/** Variant chooser + quantity + Add to cart, for a priced product page. */
export function AddToCart({
  slug,
  name,
  variants,
  max,
}: {
  slug: string;
  name: string;
  variants: { key: string; label: string; websitePrice: number }[];
  /** Free-to-issue stock, when the item is tracked in inventory. */
  max?: number;
}) {
  const [variantKey, setVariantKey] = useState(variants[0]?.key ?? "default");
  const [qty, setQty] = useState(1);
  // Never let the box offer more than we hold (the server enforces this too).
  const cap = Math.max(1, Math.min(MAX_LINE_QTY, max ?? MAX_LINE_QTY));

  function add() {
    addToCart(slug, variantKey, qty);
    showToast(`${name} added to cart`);
    openCartPanel();
  }

  return (
    <div className="space-y-3">
      {variants.length > 1 && (
        <label className="block space-y-1.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-[#526173]">Option</span>
          <select
            value={variantKey}
            onChange={(e) => setVariantKey(e.target.value)}
            className="h-12 w-full rounded border border-[var(--store-line)] bg-white px-3 text-[14px] outline-none focus:border-[var(--store-accent)]"
          >
            {variants.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label || "Standard"} — {peso(v.websitePrice)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-end gap-2.5">
        <label className="space-y-1.5">
          <span className="block text-[11px] font-extrabold uppercase tracking-wide text-[#526173]">Qty</span>
          <input
            type="number"
            min={1}
            max={cap}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(cap, Math.floor(Number(e.target.value)) || 1)))}
            className="h-12 w-20 rounded border border-[var(--store-line)] bg-white px-3 text-center text-[14px] outline-none focus:border-[var(--store-accent)]"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="h-12 flex-1 rounded-[5px] bg-[var(--store-accent)] px-5 text-[14px] font-extrabold text-white shadow-[0_12px_32px_rgba(229,32,43,0.22)] transition-colors hover:bg-[var(--store-accent-dark)]"
        >
          Add to cart
        </button>
      </div>
    </div>
  );
}
