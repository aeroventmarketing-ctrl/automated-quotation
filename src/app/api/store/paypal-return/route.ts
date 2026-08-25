import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { capturePayPalOrder } from "@/lib/payments/paypal";
import { markStoreOrderPaid } from "@/lib/store-payment";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Where PayPal returns the buyer after they approve. Approval alone is NOT
 * payment — the money only moves on capture, so we capture here and settle the
 * order from the capture's own reported amount (re-checked against the order
 * total in `markStoreOrderPaid`).
 *
 * The PayPal order id is taken from OUR stored `providerRef` rather than the
 * query string, so a hand-crafted return URL can't point an order at somebody
 * else's payment.
 */
export async function GET(req: NextRequest) {
  const appUrl = config.appUrl.replace(/\/+$/, "");
  const orderNumber = (req.nextUrl.searchParams.get("order") ?? "").trim();
  const back = (suffix: string) =>
    NextResponse.redirect(`${appUrl}/store/order/${encodeURIComponent(orderNumber)}${suffix}`);

  if (!orderNumber) return NextResponse.redirect(`${appUrl}/store`);

  const order = await prisma.storeOrder
    .findUnique({ where: { orderNumber }, select: { status: true, provider: true, providerRef: true } })
    .catch(() => null);
  if (!order) return NextResponse.redirect(`${appUrl}/store`);
  if (order.status === "PAID" || order.status === "FULFILLED") return back("?paid=1");
  if (order.provider !== "paypal" || !order.providerRef) return back("?payfailed=1");

  try {
    const cap = await capturePayPalOrder(order.providerRef);
    if (cap.status?.toUpperCase() !== "COMPLETED") return back("?payfailed=1");

    const res = await markStoreOrderPaid({
      orderNumber,
      provider: "paypal",
      providerRef: cap.id || order.providerRef,
      amountPaid: cap.amount,
      currency: cap.currency,
    });
    return back(res.ok ? "?paid=1" : "?payfailed=1");
  } catch (e) {
    console.error("paypal return error", e);
    return back("?payfailed=1");
  }
}
