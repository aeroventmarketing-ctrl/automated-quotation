"use client";

import { useState } from "react";

/**
 * Payment buttons on an unpaid order. Sends only the order number — the amount
 * is read server-side from the order, so nothing here can change what's owed.
 * On success the browser is sent to the gateway's hosted checkout page.
 */
export function PayButtons({
  orderNumber,
  hitpay,
  paypal,
}: {
  orderNumber: string;
  hitpay: boolean;
  paypal: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pay(provider: "hitpay" | "paypal") {
    setBusy(provider);
    setErr(null);
    try {
      const res = await fetch("/api/store/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, provider }),
      });
      const j = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !j.url) {
        setErr(j.error ?? "Could not start the payment.");
        setBusy(null);
        return;
      }
      window.location.href = j.url;
    } catch {
      setErr("Could not start the payment. Please try again.");
      setBusy(null);
    }
  }

  if (!hitpay && !paypal) {
    return (
      <p className="text-[13.5px] text-[var(--store-steel)]">
        Online payment isn&rsquo;t switched on yet — our team will contact you to arrange payment and delivery.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {hitpay && (
          <button
            type="button"
            onClick={() => pay("hitpay")}
            disabled={busy !== null}
            className="rounded-[5px] bg-[var(--store-accent)] px-5 py-3.5 text-[14px] font-extrabold text-white transition-colors hover:bg-[var(--store-accent-dark)] disabled:opacity-60"
          >
            {busy === "hitpay" ? "Opening checkout…" : "Pay with card / GCash / Maya"}
          </button>
        )}
        {paypal && (
          <button
            type="button"
            onClick={() => pay("paypal")}
            disabled={busy !== null}
            className="rounded-[5px] border-2 border-[#003087] px-5 py-3.5 text-[14px] font-extrabold text-[#003087] transition-colors hover:bg-[#003087]/5 disabled:opacity-60"
          >
            {busy === "paypal" ? "Opening PayPal…" : "Pay with PayPal"}
          </button>
        )}
      </div>
      {err && <p className="text-[13px] font-semibold text-[var(--store-accent)]">{err}</p>}
      <p className="text-[11.5px] text-[var(--store-steel)]">You&rsquo;ll be taken to a secure checkout page to complete the payment.</p>
    </div>
  );
}
