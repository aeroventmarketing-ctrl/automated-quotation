"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart, setCartQty, removeFromCart } from "./cart-store";
import { priceCartAction } from "./actions";
import { closePanels } from "./ui-store";
import { Overlay, CloseButton, Kicker, BrowseLink } from "./store-chrome";
import { MAX_LINE_QTY, type PricedCart } from "@/lib/store-cart";
import { peso } from "@/lib/store-product";

/**
 * Slide-over cart. The browser holds only slugs + quantities; the server
 * re-prices on every change (`priceCartAction`), so what's shown here is always
 * the live catalogue price and stock position — and the checkout that follows
 * re-prices again before an order is created.
 */
export function CartDrawer() {
  const lines = useCart();
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

  const empty = !loading && (!cart || cart.lines.length === 0);

  return (
    <Overlay labelledBy="cart-drawer-title">
      <aside className="absolute right-0 top-0 flex h-full w-[min(440px,100%)] flex-col overflow-y-auto bg-white p-7 shadow-[-20px_0_70px_rgba(0,0,0,0.2)]">
        <CloseButton />
        <Kicker>Your selection</Kicker>
        <h2
          id="cart-drawer-title"
          className="mt-2 font-[family-name:var(--font-display)] text-[32px] font-bold uppercase leading-none text-[var(--store-text)]"
        >
          Shopping Cart
        </h2>

        {loading && !cart ? (
          <div className="mt-8 space-y-3">
            {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />)}
          </div>
        ) : empty ? (
          <div className="mt-6">
            <div className="border border-dashed border-[#bcc6d0] p-9 text-center text-[13.5px] leading-relaxed text-[var(--store-steel)]">
              Your cart is empty.
              <br />
              Explore the catalogue to add stocked products.
            </div>
            <BrowseLink />
          </div>
        ) : (
          cart && (
            <>
              {cart.dropped.length > 0 && (
                <div className="mt-5 border-l-2 border-[var(--store-accent)] bg-[#fdf2f3] p-3.5 text-[12px] leading-relaxed text-[#8b1d24]">
                  <span className="font-bold">We adjusted your cart.</span>{" "}
                  {cart.dropped.map((d) => `${d.slug} — ${d.reason}`).join("; ")}.
                </div>
              )}

              <div className="mt-5">
                {cart.lines.map((l) => (
                  <div
                    key={`${l.slug}::${l.variantKey}`}
                    className="grid grid-cols-[55px_1fr_auto] items-center gap-3 border-b border-[var(--store-line)] py-3.5"
                  >
                    <Link
                      href={`/store/p/${l.slug}`}
                      onClick={closePanels}
                      className="grid h-[55px] place-items-center overflow-hidden rounded bg-[#dce3e8] font-black text-[var(--store-steel)]"
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
                        <span className="text-[13px]">{l.qty}×</span>
                      )}
                    </Link>

                    <div className="min-w-0">
                      <Link
                        href={`/store/p/${l.slug}`}
                        onClick={closePanels}
                        className="block text-[12px] font-bold leading-snug text-[var(--store-text)] hover:text-[var(--store-accent)]"
                      >
                        {l.name}
                      </Link>
                      <div className="mt-0.5 text-[10px] text-[var(--store-steel)]">
                        {l.modelCode}
                        {l.variantLabel ? ` · ${l.variantLabel}` : ""} · {peso(l.unitPrice)}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={MAX_LINE_QTY}
                          value={l.qty}
                          aria-label={`Quantity for ${l.name}`}
                          onChange={(e) =>
                            setCartQty(
                              l.slug,
                              l.variantKey,
                              Math.max(0, Math.min(MAX_LINE_QTY, Math.floor(Number(e.target.value)) || 0)),
                            )
                          }
                          className="h-8 w-14 rounded border border-[var(--store-line)] bg-white px-1.5 text-center text-[12px] outline-none focus:border-[var(--store-accent)]"
                        />
                        <button
                          type="button"
                          onClick={() => removeFromCart(l.slug, l.variantKey)}
                          className="text-[11px] font-semibold text-[var(--store-steel)] transition-colors hover:text-[var(--store-accent)]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <b className="self-start text-[13px] tabular-nums text-[var(--store-text)]">{peso(l.lineTotal)}</b>
                  </div>
                ))}
              </div>

              <div className="my-6 flex justify-between text-[18px] font-black text-[var(--store-text)]">
                <span>Total</span>
                <span className="tabular-nums">{peso(cart.total)}</span>
              </div>
              <div className="bg-[#f3f6f8] p-3 text-[11px] leading-relaxed text-[var(--store-steel)]">
                VAT-inclusive. Delivery is scheduled after checkout — stock and freight for your location are confirmed
                by our team.
              </div>
              <Link
                href="/store/checkout"
                onClick={closePanels}
                className="mt-4 flex w-full items-center justify-center rounded-md bg-[var(--store-accent)] px-5 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
              >
                Proceed to checkout →
              </Link>
              <button
                type="button"
                onClick={closePanels}
                className="mt-2.5 w-full text-center text-[12.5px] font-medium text-[var(--store-steel)] transition-colors hover:text-[var(--store-accent)]"
              >
                Continue shopping
              </button>
            </>
          )
        )}
      </aside>
    </Overlay>
  );
}
