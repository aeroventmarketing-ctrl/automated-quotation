"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag, Trash2, ArrowRight, AlertCircle } from "lucide-react";
import { useCart, setCartQty, removeFromCart, useMounted } from "../cart-store";
import { priceCartAction } from "../actions";
import { MAX_LINE_QTY, type PricedCart } from "@/lib/store-cart";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Cart. The browser holds only slugs + quantities; the server re-prices on every
 * change, so what's shown is always the live catalogue price and stock position.
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
    return (
      <div className="mx-auto max-w-6xl px-4 py-24 text-center lg:px-8">
        <div className="mx-auto h-6 w-24 animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center lg:px-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <ShoppingBag className="h-7 w-7 text-slate-400" />
        </div>
        <h1 className="mt-6 font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900">
          Your cart is empty
        </h1>
        <p className="mt-2 text-[14.5px] text-slate-600">Browse the catalogue and add what you need.</p>
        {cart?.dropped.length ? (
          <p className="mt-3 text-[13px] text-amber-700">
            {cart.dropped.length} item{cart.dropped.length === 1 ? " was" : "s were"} removed — {cart.dropped[0].reason}.
          </p>
        ) : null}
        <Link
          href="/store"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--store-accent)] px-6 py-3 text-[14px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
        >
          Browse products <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 lg:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
        Your cart
      </h1>
      <p className="mt-1.5 text-[14px] text-slate-600">
        {cart.lines.length} item{cart.lines.length === 1 ? "" : "s"}
      </p>

      {cart.dropped.length > 0 && (
        <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13.5px] text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">We adjusted your cart.</span>{" "}
            {cart.dropped.map((d) => `${d.slug} — ${d.reason}`).join("; ")}.
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
          {cart.lines.map((l) => (
            <li key={`${l.slug}::${l.variantKey}`} className="flex flex-wrap items-center gap-4 bg-white p-4">
              <Link
                href={`/store/p/${l.slug}`}
                className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
              >
                {l.photoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/store-image?path=${encodeURIComponent(l.photoPath)}`}
                    alt={l.name}
                    className="h-full w-full object-contain p-2"
                    loading="lazy"
                  />
                ) : (
                  <span className="px-1 text-center font-mono text-[9px] text-slate-400">{l.modelCode}</span>
                )}
              </Link>

              <div className="min-w-[10rem] flex-1">
                <Link
                  href={`/store/p/${l.slug}`}
                  className="font-[family-name:var(--font-display)] text-[14.5px] font-bold text-slate-900 transition-colors hover:text-[var(--store-accent)]"
                >
                  {l.name}
                </Link>
                <div className="mt-1 text-[12.5px] text-slate-500">
                  <span className="font-mono">{l.modelCode}</span>
                  {l.variantLabel && <> · {l.variantLabel}</>} · {peso(l.unitPrice)} per {l.unit}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={MAX_LINE_QTY}
                  value={l.qty}
                  onChange={(e) =>
                    setCartQty(l.slug, l.variantKey, Math.max(0, Math.min(MAX_LINE_QTY, Math.floor(Number(e.target.value)) || 0)))
                  }
                  className="h-10 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-[14px] outline-none focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15"
                  aria-label={`Quantity for ${l.name}`}
                />
                <div className="w-24 text-right font-[family-name:var(--font-display)] text-[15px] font-bold tabular-nums text-slate-900">
                  {peso(l.lineTotal)}
                </div>
                <button
                  type="button"
                  onClick={() => removeFromCart(l.slug, l.variantKey)}
                  aria-label={`Remove ${l.name}`}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-[var(--store-accent)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_14px_-6px_rgba(15,23,42,0.12)]">
            <h2 className="font-[family-name:var(--font-display)] text-[15px] font-bold text-slate-900">Summary</h2>
            <div className="mt-4 flex items-baseline justify-between border-t border-slate-100 pt-4">
              <span className="text-[13.5px] text-slate-600">Total</span>
              <span className="font-[family-name:var(--font-display)] text-[26px] font-extrabold tracking-tight text-slate-900">
                {peso(cart.total)}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-slate-500">VAT-inclusive. Delivery quoted after checkout.</p>
            <Link
              href="/store/checkout"
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--store-accent)] px-5 py-3.5 text-[14.5px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
            >
              Checkout <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/store"
              className="mt-2.5 block text-center text-[13px] font-medium text-slate-500 transition-colors hover:text-[var(--store-accent)]"
            >
              Continue shopping
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
