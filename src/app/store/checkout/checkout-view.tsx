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

  if (!mounted || !cart) return <p className="py-12 text-center text-sm text-gray-500">Loading…</p>;

  if (cart.lines.length === 0) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-gray-600">Your cart is empty.</p>
        <Link href="/store" className="inline-block rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c2141a]">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Checkout</h1>
      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        {/* Details */}
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Your details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-700">Full name *</span>
              <input value={form.buyerName} onChange={(e) => set({ buyerName: e.target.value })} className="h-10 w-full rounded-md border px-2 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-700">Company (optional)</span>
              <input value={form.company} onChange={(e) => set({ company: e.target.value })} className="h-10 w-full rounded-md border px-2 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-700">Email *</span>
              <input type="email" value={form.buyerEmail} onChange={(e) => set({ buyerEmail: e.target.value })} className="h-10 w-full rounded-md border px-2 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-700">Contact number *</span>
              <input value={form.buyerPhone} onChange={(e) => set({ buyerPhone: e.target.value })} className="h-10 w-full rounded-md border px-2 text-sm" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-700">Delivery address *</span>
            <textarea value={form.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} rows={3} className="w-full rounded-md border px-2 py-1.5 text-sm" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-700">Notes (optional)</span>
            <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className="w-full rounded-md border px-2 py-1.5 text-sm" />
          </label>
          <p className="text-xs text-gray-500">
            Delivery is arranged after the order is confirmed — our team will contact you with the schedule and any
            freight cost for your location.
          </p>
        </div>

        {/* Summary */}
        <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
          <h2 className="text-sm font-semibold">Order summary</h2>
          <ul className="space-y-2 text-sm">
            {cart.lines.map((l) => (
              <li key={`${l.slug}::${l.variantKey}`} className="flex justify-between gap-2">
                <span className="text-gray-700">
                  {l.name}
                  {l.variantLabel ? ` (${l.variantLabel})` : ""} × {l.qty}
                </span>
                <span className="shrink-0 tabular-nums">{peso(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t pt-2 font-bold">
            <span>Total</span>
            <span className="tabular-nums text-[#ED1C24]">{peso(cart.total)}</span>
          </div>
          <p className="text-[11px] text-gray-500">VAT-inclusive. Prices confirmed against the live catalogue.</p>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-md bg-[#ED1C24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#c2141a] disabled:opacity-60"
          >
            {busy ? "Placing order…" : "Place order"}
          </button>
          {err && <p className="text-xs text-destructive text-red-600">{err}</p>}
          <Link href="/store/cart" className="block text-center text-xs text-gray-500 hover:text-[#ED1C24]">← Back to cart</Link>
        </div>
      </div>
    </div>
  );
}
