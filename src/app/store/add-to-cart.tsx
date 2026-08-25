"use client";

import { useState } from "react";
import Link from "next/link";
import { addToCart } from "./cart-store";
import { MAX_LINE_QTY } from "@/lib/store-cart";

/** Variant chooser + quantity + Add to cart, for a priced product page. */
export function AddToCart({
  slug,
  variants,
  max,
}: {
  slug: string;
  variants: { key: string; label: string; websitePrice: number }[];
  /** Free-to-issue stock, when the item is tracked in inventory. */
  max?: number;
}) {
  const [variantKey, setVariantKey] = useState(variants[0]?.key ?? "default");
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  // Never let the box offer more than we hold (the server enforces this too).
  const cap = Math.max(1, Math.min(MAX_LINE_QTY, max ?? MAX_LINE_QTY));

  function add() {
    addToCart(slug, variantKey, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  return (
    <div className="space-y-3">
      {variants.length > 1 && (
        <label className="block space-y-1">
          <span className="text-[12.5px] font-semibold text-slate-700">Option</span>
          <select
            value={variantKey}
            onChange={(e) => setVariantKey(e.target.value)}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] outline-none focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15"
          >
            {variants.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label || "Standard"} — ₱{v.websitePrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center gap-2">
        <label className="space-y-1">
          <span className="text-[12.5px] font-semibold text-slate-700">Qty</span>
          <input
            type="number"
            min={1}
            max={cap}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(cap, Math.floor(Number(e.target.value)) || 1)))}
            className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-3 text-center text-[14px] outline-none focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="mt-5 flex-1 rounded-full bg-[var(--store-accent)] px-5 py-3 text-[14.5px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
        >
          Add to cart
        </button>
      </div>

      {added && (
        <p className="text-[13.5px] font-medium text-emerald-700">
          Added to cart. <Link href="/store/cart" className="font-semibold underline">View cart →</Link>
        </p>
      )}
    </div>
  );
}
