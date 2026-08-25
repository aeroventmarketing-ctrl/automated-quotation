"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart, setCartQty, removeFromCart, useMounted } from "../cart-store";
import { priceCartAction } from "../actions";
import { MAX_LINE_QTY, type PricedCart } from "@/lib/store-cart";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Cart page. The browser holds only slugs + quantities; the server prices them
 * on every change, so what's shown is always the live catalogue price.
 */
export function CartView() {
  const lines = useCart();
  const mounted = useMounted();
  const [cart, setCart] = useState<PricedCart | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    priceCartAction(lines)
      .then((c) => { if (live) setCart(c); })
      .catch(() => { if (live) setCart(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [lines]);

  if (!mounted || (loading && !cart)) {
    return <p className="py-12 text-center text-sm text-gray-500">Loading your cart…</p>;
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-gray-600">Your cart is empty.</p>
        {cart?.dropped.length ? (
          <p className="text-xs text-amber-700">
            {cart.dropped.length} item{cart.dropped.length === 1 ? " was" : "s were"} removed — {cart.dropped[0].reason}.
          </p>
        ) : null}
        <Link href="/store" className="inline-block rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c2141a]">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Your cart</h1>

      {cart.dropped.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Some items were removed: {cart.dropped.map((d) => `${d.slug} (${d.reason})`).join(", ")}.
        </div>
      )}

      <ul className="divide-y rounded-lg border">
        {cart.lines.map((l) => (
          <li key={`${l.slug}::${l.variantKey}`} className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-gray-50">
              {l.photoPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/store-image?path=${encodeURIComponent(l.photoPath)}`} alt={l.name} className="h-full w-full object-contain" />
              ) : (
                <span className="px-1 text-center text-[10px] text-gray-400">{l.modelCode}</span>
              )}
            </div>
            <div className="min-w-[10rem] flex-1">
              <Link href={`/store/p/${l.slug}`} className="text-sm font-medium hover:text-[#ED1C24]">{l.name}</Link>
              <div className="text-xs text-gray-500">
                {l.modelCode}{l.variantLabel ? ` · ${l.variantLabel}` : ""} · {peso(l.unitPrice)} per {l.unit}
              </div>
            </div>
            <input
              type="number"
              min={1}
              max={MAX_LINE_QTY}
              value={l.qty}
              onChange={(e) => setCartQty(l.slug, l.variantKey, Math.max(0, Math.min(MAX_LINE_QTY, Math.floor(Number(e.target.value)) || 0)))}
              className="h-9 w-16 rounded-md border px-2 text-sm"
              aria-label={`Quantity for ${l.name}`}
            />
            <div className="w-28 text-right text-sm font-semibold tabular-nums">{peso(l.lineTotal)}</div>
            <button
              type="button"
              onClick={() => removeFromCart(l.slug, l.variantKey)}
              className="text-xs text-gray-500 hover:text-[#ED1C24]"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-gray-50 p-4">
        <div>
          <div className="text-xs text-gray-500">Total (VAT-inclusive)</div>
          <div className="text-2xl font-bold text-[#ED1C24]">{peso(cart.total)}</div>
        </div>
        <div className="flex gap-2">
          <Link href="/store" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-white">Continue shopping</Link>
          <Link href="/store/checkout" className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c2141a]">
            Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}
