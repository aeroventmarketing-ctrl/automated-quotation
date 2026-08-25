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
          <span className="text-xs font-medium text-gray-700">Option</span>
          <select
            value={variantKey}
            onChange={(e) => setVariantKey(e.target.value)}
            className="h-10 w-full rounded-md border bg-white px-2 text-sm"
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
          <span className="text-xs font-medium text-gray-700">Qty</span>
          <input
            type="number"
            min={1}
            max={cap}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(cap, Math.floor(Number(e.target.value)) || 1)))}
            className="h-10 w-20 rounded-md border bg-white px-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="mt-5 flex-1 rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#c2141a]"
        >
          Add to cart
        </button>
      </div>

      {added && (
        <p className="text-sm text-emerald-700">
          Added to cart. <Link href="/store/cart" className="font-semibold underline">View cart →</Link>
        </p>
      )}
    </div>
  );
}
