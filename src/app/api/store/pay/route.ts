import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { createHitpayPayment, hitpayConfigured } from "@/lib/payments/hitpay";
import { createPayPalOrder, paypalConfigured } from "@/lib/payments/paypal";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Start payment for a storefront order.
 *
 * Public (shoppers have no account), so the ONLY thing the browser supplies is
 * the order number and the chosen provider — the amount is read from the order
 * row, never from the request. Returns the hosted-checkout URL to redirect to.
 */
export async function POST(req: NextRequest) {
  let body: { orderNumber?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const orderNumber = (body.orderNumber ?? "").trim();
  const provider = (body.provider ?? "").trim().toLowerCase();
  if (!orderNumber) return NextResponse.json({ error: "orderNumber is required." }, { status: 400 });
  if (provider !== "hitpay" && provider !== "paypal") {
    return NextResponse.json({ error: "Choose a payment method." }, { status: 400 });
  }

  const order = await prisma.storeOrder
    .findUnique({
      where: { orderNumber },
      select: { orderNumber: true, status: true, total: true, currency: true, buyerName: true, buyerEmail: true, buyerPhone: true },
    })
    .catch(() => null);
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status === "PAID" || order.status === "FULFILLED") {
    return NextResponse.json({ error: "This order is already paid." }, { status: 409 });
  }
  if (order.status === "CANCELLED") return NextResponse.json({ error: "This order was cancelled." }, { status: 409 });

  const amount = Number(order.total);
  if (!(amount > 0)) return NextResponse.json({ error: "This order has no payable amount." }, { status: 400 });

  const appUrl = config.appUrl.replace(/\/+$/, "");
  const purpose = `Aerovent order ${order.orderNumber}`;

  try {
    if (provider === "hitpay") {
      if (!hitpayConfigured()) return NextResponse.json({ error: "Card / e-wallet payment isn't available yet." }, { status: 503 });
      const pr = await createHitpayPayment({
        amount,
        currency: order.currency,
        referenceNumber: order.orderNumber,
        purpose,
        name: order.buyerName,
        email: order.buyerEmail,
        phone: order.buyerPhone,
        redirectUrl: `${appUrl}/store/order/${encodeURIComponent(order.orderNumber)}?paid=1`,
        webhook: `${appUrl}/api/store/hitpay-webhook`,
      });
      // Remember the reference so the webhook / return can be tied back.
      await prisma.storeOrder.update({
        where: { orderNumber: order.orderNumber },
        data: { provider: "hitpay", providerRef: pr.id },
      });
      return NextResponse.json({ url: pr.url });
    }

    if (!paypalConfigured()) return NextResponse.json({ error: "PayPal isn't available yet." }, { status: 503 });
    const pp = await createPayPalOrder({
      amount,
      currency: order.currency,
      referenceNumber: order.orderNumber,
      description: purpose,
      returnUrl: `${appUrl}/api/store/paypal-return?order=${encodeURIComponent(order.orderNumber)}`,
      cancelUrl: `${appUrl}/store/order/${encodeURIComponent(order.orderNumber)}?cancelled=1`,
    });
    await prisma.storeOrder.update({
      where: { orderNumber: order.orderNumber },
      data: { provider: "paypal", providerRef: pp.id },
    });
    return NextResponse.json({ url: pp.approveUrl });
  } catch (e) {
    console.error("store pay error", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Could not start the payment: ${detail}` }, { status: 502 });
  }
}
