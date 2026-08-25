import { NextRequest, NextResponse } from "next/server";
import { verifyHitpayHmac } from "@/lib/payments/hitpay";
import { markStoreOrderPaid } from "@/lib/store-payment";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * HitPay payment webhook — the authoritative confirmation that an order was
 * paid (the buyer's return to the site is only a convenience; they may close
 * the tab before it happens).
 *
 * The body is form-encoded and carries an `hmac` signed with our API salt.
 * NOTHING is trusted until that signature verifies — an unsigned or mis-signed
 * callback is rejected outright, so a forged POST can't mark an order paid.
 * The amount is then re-checked against the order total in `markStoreOrderPaid`.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    const form = await req.formData();
    body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!verifyHitpayHmac(body)) {
    console.error("hitpay webhook: HMAC verification failed", { ref: body.reference_number });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Only a completed payment settles the order; other statuses are acknowledged
  // (so HitPay stops retrying) but change nothing.
  const status = (body.status ?? "").toLowerCase();
  const orderNumber = (body.reference_number ?? "").trim();
  if (!orderNumber) return NextResponse.json({ ok: true, ignored: "no reference_number" });
  if (status !== "completed" && status !== "succeeded") {
    return NextResponse.json({ ok: true, ignored: `status ${status || "(none)"}` });
  }

  const amount = Number(body.amount);
  const res = await markStoreOrderPaid({
    orderNumber,
    provider: "hitpay",
    providerRef: body.payment_request_id || body.payment_id || "",
    amountPaid: Number.isFinite(amount) ? amount : null,
    currency: body.currency ?? null,
  });

  if (!res.ok) {
    console.error(`hitpay webhook: could not settle ${orderNumber} — ${res.reason}`);
    // 200 so HitPay doesn't retry forever on a business-rule mismatch; the log
    // + the still-PENDING order are the signal for a human to look.
    return NextResponse.json({ ok: false, reason: res.reason });
  }
  return NextResponse.json({ ok: true, alreadyPaid: res.alreadyPaid });
}
