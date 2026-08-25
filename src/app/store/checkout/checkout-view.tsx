"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, clearCart, useMounted } from "../cart-store";
import { priceCartAction, placeOrder } from "../actions";
import type { PricedCart } from "@/lib/store-cart";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Checkout — buyer details + delivery address, with the server-priced order
 * summary beside it. Placing the order creates a PENDING_PAYMENT StoreOrder;
 * the payment step (HitPay / PayPal) is wired on next.
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
      <div className="mx-auto max-w-6xl px-4 py-24 text-center lg:px-8">
        <div className="mx-auto h-6 w-24 animate-pulse rounded bg-slate-200" />
      </div>
    );

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center lg:px-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900">Your cart is empty</h1>
        <Link href="/store" className="mt-6 inline-block rounded-full bg-[var(--store-accent)] px-6 py-3 text-[14px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)]">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 lg:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">Checkout</h1>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Details */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-[family-name:var(--font-display)] text-[15px] font-bold text-slate-900">Your details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[12.5px] font-semibold text-slate-700">Full name *</span>
              <input value={form.buyerName} onChange={(e) => set({ buyerName: e.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15" />
            </label>
            <label className="space-y-1">
              <span className="text-[12.5px] font-semibold text-slate-700">Company (optional)</span>
              <input value={form.company} onChange={(e) => set({ company: e.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15" />
            </label>
            <label className="space-y-1">
              <span className="text-[12.5px] font-semibold text-slate-700">Email *</span>
              <input type="email" value={form.buyerEmail} onChange={(e) => set({ buyerEmail: e.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15" />
            </label>
            <label className="space-y-1">
              <span className="text-[12.5px] font-semibold text-slate-700">Contact number *</span>
              <input value={form.buyerPhone} onChange={(e) => set({ buyerPhone: e.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[12.5px] font-semibold text-slate-700">Delivery address *</span>
            <textarea value={form.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15" />
          </label>
          <label className="block space-y-1">
            <span className="text-[12.5px] font-semibold text-slate-700">Notes (optional)</span>
            <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--store-accent)] focus:ring-2 focus:ring-[var(--store-accent)]/15" />
          </label>
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            Delivery is arranged after the order is confirmed — our team will contact you with the schedule and any
            freight cost for your location.
          </p>
        </div>

        {/* Summary */}
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_14px_-6px_rgba(15,23,42,0.12)] lg:sticky lg:top-24">
          <h2 className="font-[family-name:var(--font-display)] text-[15px] font-bold text-slate-900">Order summary</h2>
          <ul className="space-y-2 text-sm">
            {cart.lines.map((l) => (
              <li key={`${l.slug}::${l.variantKey}`} className="flex justify-between gap-2">
                <span className="text-slate-700">
                  {l.name}
                  {l.variantLabel ? ` (${l.variantLabel})` : ""} × {l.qty}
                </span>
                <span className="shrink-0 tabular-nums">{peso(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
            <span className="text-[13.5px] text-slate-600">Total</span>
            <span className="font-[family-name:var(--font-display)] text-[24px] font-extrabold tracking-tight text-slate-900">{peso(cart.total)}</span>
          </div>
          <p className="text-[11.5px] text-slate-500">VAT-inclusive. Prices confirmed against the live catalogue.</p>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-full bg-[var(--store-accent)] px-5 py-3.5 text-[14.5px] font-bold text-white transition-colors hover:bg-[var(--store-accent-dark)] disabled:opacity-60"
          >
            {busy ? "Placing order…" : "Place order"}
          </button>
          {err && <p className="text-[13px] font-medium text-red-600">{err}</p>}
          <Link href="/store/cart" className="block text-center text-[13px] font-medium text-slate-500 transition-colors hover:text-[var(--store-accent)]">← Back to cart</Link>
        </div>
      </div>
    </div>
  );
}
