"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, clearCart, useMounted } from "../cart-store";
import { priceCartAction, placeOrder } from "../actions";
import type { PricedCart } from "@/lib/store-cart";
import { peso } from "@/lib/store-product";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";

const FIELD =
  "h-12 w-full rounded border border-[var(--store-line)] bg-white px-3 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)]";
const LABEL = "text-[11px] font-extrabold uppercase tracking-wide text-[#526173]";

/**
 * Checkout — buyer details + delivery address, with the server-priced order
 * summary beside it. Placing the order creates a PENDING_PAYMENT StoreOrder;
 * the order page that follows carries the HitPay / PayPal buttons.
 */
export function CheckoutView() {
  const router = useRouter();
  const lines = useCart();
  const mounted = useMounted();
  const [cart, setCart] = useState<PricedCart | null>(null);
  const [form, setForm] = useState({ buyerName: "", buyerEmail: "", buyerPhone: "", company: "", deliveryAddress: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    priceCartAction(lines).then((c) => { if (live) setCart(c); }).catch(() => { if (live) setCart(null); });
    return () => { live = false; };
  }, [lines]);

  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await placeOrder(lines, form);
      if (!res.ok) { setErr(res.message); setBusy(false); return; }
      clearCart();
      router.push(`/store/order/${encodeURIComponent(res.orderNumber)}`);
    } catch {
      setErr("Could not place the order. Please try again.");
      setBusy(false);
    }
  }

  if (!mounted || !cart)
    return (
      <div className={`${WRAP} py-24 text-center`}>
        <div className="mx-auto h-6 w-24 animate-pulse rounded bg-slate-200" />
      </div>
    );

  if (cart.lines.length === 0) {
    return (
      <div className={`${WRAP} py-24 text-center`}>
        <h1 className={`${DISPLAY} text-[42px] leading-none`}>Your cart is empty</h1>
        <Link
          href="/store#products"
          className="mt-6 inline-block rounded-[5px] bg-[var(--store-accent)] px-6 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)]"
        >
          Explore the catalogue →
        </Link>
      </div>
    );
  }

  return (
    <div className={`${WRAP} py-12`}>
      <div className={KICKER}>Secure order</div>
      <h1 className={`${DISPLAY} mt-2 text-[42px] leading-none`}>Checkout</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Details */}
        <div className="space-y-4 rounded-md border border-[var(--store-line)] bg-white p-6">
          <h2 className={`${DISPLAY} text-[24px] leading-none`}>Your details</h2>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Full name *</span>
              <input value={form.buyerName} onChange={(e) => set({ buyerName: e.target.value })} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Company (optional)</span>
              <input value={form.company} onChange={(e) => set({ company: e.target.value })} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Email *</span>
              <input type="email" value={form.buyerEmail} onChange={(e) => set({ buyerEmail: e.target.value })} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Contact number *</span>
              <input value={form.buyerPhone} onChange={(e) => set({ buyerPhone: e.target.value })} className={FIELD} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Delivery address *</span>
            <textarea
              value={form.deliveryAddress}
              onChange={(e) => set({ deliveryAddress: e.target.value })}
              rows={3}
              className={`${FIELD} h-auto resize-y py-3`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Notes (optional)</span>
            <textarea
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={2}
              className={`${FIELD} h-auto resize-y py-3`}
            />
          </label>
          <p className="bg-[#f3f6f8] p-3 text-[11.5px] leading-relaxed text-[var(--store-steel)]">
            Delivery is arranged after the order is confirmed — our team will contact you with the schedule and any
            freight cost for your location.
          </p>
        </div>

        {/* Summary */}
        <div className="space-y-3 rounded-md border border-[var(--store-line)] bg-white p-5 shadow-[0_8px_28px_-16px_rgba(9,20,38,0.35)] lg:sticky lg:top-28 lg:self-start">
          <h2 className={`${DISPLAY} text-[24px] leading-none`}>Order summary</h2>
          <ul className="space-y-2 text-[13px]">
            {cart.lines.map((l) => (
              <li key={`${l.slug}::${l.variantKey}`} className="flex justify-between gap-2">
                <span className="text-[#536275]">
                  {l.name}
                  {l.variantLabel ? ` (${l.variantLabel})` : ""} × {l.qty}
                </span>
                <span className="shrink-0 tabular-nums">{peso(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-[#edf0f2] pt-3">
            <span className="text-[13px] text-[var(--store-steel)]">Total</span>
            <span className={`${DISPLAY} text-[28px] leading-none tabular-nums`}>{peso(cart.total)}</span>
          </div>
          <p className="text-[11.5px] text-[var(--store-steel)]">
            VAT-inclusive. Prices confirmed against the live catalogue.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-[5px] bg-[var(--store-accent)] px-5 py-4 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)] disabled:opacity-60"
          >
            {busy ? "Placing order…" : "Place order →"}
          </button>
          {err && <p className="text-[13px] font-semibold text-[var(--store-accent)]">{err}</p>}
          <Link
            href="/store/cart"
            className="block text-center text-[12.5px] font-medium text-[var(--store-steel)] transition-colors hover:text-[var(--store-accent)]"
          >
            ← Back to cart
          </Link>
        </div>
      </div>
    </div>
  );
}
