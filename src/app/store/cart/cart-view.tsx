"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart, setCartQty, removeFromCart, useMounted } from "../cart-store";
import { priceCartAction } from "../actions";
import { MAX_LINE_QTY, type PricedCart } from "@/lib/store-cart";
import { peso } from "@/lib/store-product";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";

/**
 * Cart page — the drawer's full-width counterpart, for deep links and for
 * reviewing a long order. The browser holds only slugs + quantities; the server
 * re-prices on every change, so what's shown is always the live catalogue price
 * and stock position.
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
      <div className={`${WRAP} py-24 text-center`}>
        <div className="mx-auto h-6 w-24 animate-pulse rounded bg-slate-200" />
      </div>
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className={`${WRAP} py-24 text-center`}>
        <div className={KICKER}>Your selection</div>
        <h1 className={`${DISPLAY} mt-2 text-[42px] leading-none`}>Your cart is empty</h1>
        <p className="mt-3 text-[14px] text-[var(--store-steel)]">
          Browse the catalogue and add the equipment you need.
        </p>
        {cart?.dropped.length ? (
          <p className="mt-3 text-[13px] text-[var(--store-accent)]">
            {cart.dropped.length} item{cart.dropped.length === 1 ? " was" : "s were"} removed — {cart.dropped[0].reason}.
          </p>
        ) : null}
        <Link
          href="/store#products"
          className="mt-7 inline-flex items-center rounded-[5px] bg-[var(--store-accent)] px-6 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
        >
          Explore the catalogue →
        </Link>
      </div>
    );
  }

  return (
    <div className={`${WRAP} py-12`}>
      <div className={KICKER}>Your selection</div>
      <h1 className={`${DISPLAY} mt-2 text-[42px] leading-none`}>Shopping cart</h1>
      <p className="mt-2 text-[13px] text-[var(--store-steel)]">
        {cart.lines.length} item{cart.lines.length === 1 ? "" : "s"}
      </p>

      {cart.dropped.length > 0 && (
        <div className="mt-5 border-l-2 border-[var(--store-accent)] bg-[#fdf2f3] p-4 text-[13px] text-[#8b1d24]">
          <span className="font-bold">We adjusted your cart.</span>{" "}
          {cart.dropped.map((d) => `${d.slug} — ${d.reason}`).join("; ")}.
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ul className="divide-y divide-[var(--store-line)] overflow-hidden rounded-md border border-[var(--store-line)] bg-white">
          {cart.lines.map((l) => (
            <li key={`${l.slug}::${l.variantKey}`} className="flex flex-wrap items-center gap-4 p-4">
              <Link
                href={`/store/p/${l.slug}`}
                className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded border border-[var(--store-line)] bg-[#edf1f4]"
              >
                {l.photoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/store-image?path=${encodeURIComponent(l.photoPath)}`}
                    alt={l.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="px-1 text-center text-[9px] text-[var(--store-steel)]">{l.modelCode}</span>
                )}
              </Link>

              <div className="min-w-[10rem] flex-1">
                <Link href={`/store/p/${l.slug}`} className="text-[14px] font-bold transition-colors hover:text-[var(--store-accent)]">
                  {l.name}
                </Link>
                <div className="mt-1 text-[11px] text-[var(--store-steel)]">
                  MODEL {l.modelCode}
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
                  className="h-10 w-16 rounded border border-[var(--store-line)] bg-white px-2 text-center text-[14px] outline-none focus:border-[var(--store-accent)]"
                  aria-label={`Quantity for ${l.name}`}
                />
                <div className="w-24 text-right text-[15px] font-bold tabular-nums">{peso(l.lineTotal)}</div>
                <button
                  type="button"
                  onClick={() => removeFromCart(l.slug, l.variantKey)}
                  aria-label={`Remove ${l.name}`}
                  className="rounded p-2 text-[16px] leading-none text-[var(--store-steel)] transition-colors hover:text-[var(--store-accent)]"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-md border border-[var(--store-line)] bg-white p-5 shadow-[0_8px_28px_-16px_rgba(9,20,38,0.35)]">
            <h2 className={`${DISPLAY} text-[24px] leading-none`}>Summary</h2>
            <div className="mt-4 flex items-baseline justify-between border-t border-[#edf0f2] pt-4">
              <span className="text-[13px] text-[var(--store-steel)]">Total</span>
              <span className={`${DISPLAY} text-[30px] leading-none tabular-nums`}>{peso(cart.total)}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-[var(--store-steel)]">VAT-inclusive. Delivery quoted after checkout.</p>
            <Link
              href="/store/checkout"
              className="mt-5 flex w-full items-center justify-center rounded-[5px] bg-[var(--store-accent)] px-5 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
            >
              Proceed to checkout →
            </Link>
            <Link
              href="/store#products"
              className="mt-2.5 block text-center text-[12.5px] font-medium text-[var(--store-steel)] transition-colors hover:text-[var(--store-accent)]"
            >
              Continue shopping
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
