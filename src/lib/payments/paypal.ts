/**
 * PayPal Orders v2 (storefront checkout) over the HTTP API — no SDK dependency,
 * matching the Resend / Semaphore / HitPay clients in this codebase. Endpoints
 * and hosts verified against PayPal's official server SDK.
 *
 * Flow: create an order with intent=CAPTURE → redirect the buyer to the
 * `approve` link → PayPal returns them to our return_url → we CAPTURE, and only
 * a completed capture marks the StoreOrder paid.
 *
 * Config (Vercel env): PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV
 * ("sandbox" — the default — or "production").
 */

const BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com",
} as const;

function baseUrl(): string {
  return process.env.PAYPAL_ENV === "production" ? BASE.production : BASE.sandbox;
}

/** True when PayPal is configured — otherwise the option is hidden at checkout. */
export function paypalConfigured(): boolean {
  return !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_SECRET;
}

/** OAuth2 client-credentials token (short-lived; fetched per operation). */
async function accessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_SECRET are not set");

  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`PayPal auth ${res.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal auth: no access_token in response");
  return data.access_token;
}

interface PayPalLink { href: string; rel: string; method?: string }

export interface PayPalOrder {
  id: string;
  status: string;
  links?: PayPalLink[];
}

export interface CreatePayPalInput {
  amount: number; // major units
  currency: string;
  referenceNumber: string; // our order number
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

/** Create a PayPal order and return it with its `approve` link. */
export async function createPayPalOrder(input: CreatePayPalInput): Promise<{ id: string; approveUrl: string }> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.referenceNumber,
          custom_id: input.referenceNumber,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: "Aerovent Fans & Blowers",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
  });

  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`PayPal create ${res.status}: ${raw.slice(0, 300)}`);
  const order = JSON.parse(raw) as PayPalOrder;
  const approve = order.links?.find((l) => l.rel === "approve")?.href;
  if (!order.id || !approve) throw new Error("PayPal: order had no approve link");
  return { id: order.id, approveUrl: approve };
}

export interface PayPalCapture {
  id: string;
  status: string;
  /** Captured amount, read back from the capture so we can verify what was paid. */
  amount: number | null;
  currency: string | null;
}

/**
 * Capture an approved PayPal order. Returns the capture's status and the amount
 * actually taken — the caller must check both before marking an order paid.
 */
export async function capturePayPalOrder(orderId: string): Promise<PayPalCapture> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });

  const raw = await res.text().catch(() => "");
  // A already-captured order replies 422 ORDER_ALREADY_CAPTURED — treat that as
  // "look it up" rather than an error, so a double return-visit is harmless.
  if (!res.ok && !/ORDER_ALREADY_CAPTURED/i.test(raw)) {
    throw new Error(`PayPal capture ${res.status}: ${raw.slice(0, 300)}`);
  }
  if (!res.ok) return getPayPalOrderCapture(orderId);

  const data = JSON.parse(raw) as {
    id: string;
    status: string;
    purchase_units?: { payments?: { captures?: { amount?: { value?: string; currency_code?: string } }[] } }[];
  };
  const cap = data.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
  return {
    id: data.id,
    status: data.status,
    amount: cap?.value ? Number(cap.value) : null,
    currency: cap?.currency_code ?? null,
  };
}

/** Read an order back (used when a capture was already taken). */
async function getPayPalOrderCapture(orderId: string): Promise<PayPalCapture> {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`PayPal read ${res.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as {
    id: string;
    status: string;
    purchase_units?: { payments?: { captures?: { amount?: { value?: string; currency_code?: string } }[] } }[];
  };
  const cap = data.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
  return {
    id: data.id,
    status: data.status,
    amount: cap?.value ? Number(cap.value) : null,
    currency: cap?.currency_code ?? null,
  };
}
