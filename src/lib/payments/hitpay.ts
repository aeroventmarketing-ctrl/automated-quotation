/**
 * HitPay payment requests (storefront checkout) over the HTTP API — no SDK
 * dependency, matching the Resend / Semaphore clients in this codebase.
 *
 * Flow: create a payment request for a StoreOrder → redirect the buyer to the
 * hosted checkout `url` → HitPay calls our webhook when it's paid, and also
 * bounces the buyer back to `redirect_url`.
 *
 * Config (Vercel env): HITPAY_API_KEY, HITPAY_API_SALT, HITPAY_ENV
 * ("sandbox" — the default — or "production"). The SALT is what makes webhooks
 * trustworthy: HitPay signs each callback with it, and `verifyHitpayHmac` below
 * is the only thing standing between a real payment and a forged one.
 */
import { createHmac, timingSafeEqual } from "crypto";

const BASE = {
  sandbox: "https://api.sandbox.hit-pay.com/v1",
  production: "https://api.hit-pay.com/v1",
} as const;

function baseUrl(): string {
  return process.env.HITPAY_ENV === "production" ? BASE.production : BASE.sandbox;
}

/** True when HitPay is configured (key + salt) — otherwise the option is hidden. */
export function hitpayConfigured(): boolean {
  return !!process.env.HITPAY_API_KEY && !!process.env.HITPAY_API_SALT;
}

export interface HitpayPaymentRequest {
  id: string;
  /** Hosted checkout page — where the buyer is sent to pay. */
  url: string;
  status: string;
  amount: string;
  currency: string;
  reference_number?: string;
}

export interface CreateHitpayInput {
  amount: number; // major units (PHP)
  currency: string;
  referenceNumber: string; // our order number
  purpose: string;
  name?: string;
  email?: string;
  phone?: string;
  redirectUrl: string; // buyer returns here after paying
  webhook: string; // server-to-server confirmation
}

/**
 * Create a HitPay payment request. The body is form-encoded (the API rejects
 * JSON), and auth rides in the X-BUSINESS-API-KEY header.
 */
export async function createHitpayPayment(input: CreateHitpayInput): Promise<HitpayPaymentRequest> {
  const key = process.env.HITPAY_API_KEY;
  if (!key) throw new Error("HITPAY_API_KEY is not set");

  const body = new URLSearchParams({
    amount: input.amount.toFixed(2),
    currency: input.currency,
    reference_number: input.referenceNumber,
    purpose: input.purpose,
    redirect_url: input.redirectUrl,
    webhook: input.webhook,
    // A storefront order is paid once — never allow the link to be reused.
    allow_repeated_payments: "false",
    ...(input.name ? { name: input.name } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
  });

  const res = await fetch(`${baseUrl()}/payment-requests`, {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "X-BUSINESS-API-KEY": key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HitPay ${res.status}: ${raw.slice(0, 300)}`);
  let data: HitpayPaymentRequest;
  try {
    data = JSON.parse(raw) as HitpayPaymentRequest;
  } catch {
    throw new Error(`HitPay: unexpected response ${raw.slice(0, 200)}`);
  }
  if (!data?.url || !data?.id) throw new Error("HitPay: payment request had no checkout URL");
  return data;
}

/** Read a payment request back (used to confirm status on the buyer's return). */
export async function getHitpayPayment(id: string): Promise<HitpayPaymentRequest | null> {
  const key = process.env.HITPAY_API_KEY;
  if (!key) throw new Error("HITPAY_API_KEY is not set");
  const res = await fetch(`${baseUrl()}/payment-requests/${encodeURIComponent(id)}`, {
    headers: { "X-Requested-With": "XMLHttpRequest", "X-BUSINESS-API-KEY": key },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as HitpayPaymentRequest | null;
}

/**
 * Verify a HitPay webhook body.
 *
 * HitPay's scheme: drop `hmac`, sort the remaining keys alphabetically,
 * concatenate `key + value` with no separators, HMAC-SHA256 it with the API
 * salt, and compare the hex digest to the `hmac` field. Compared in constant
 * time so the check can't be probed byte by byte.
 */
export function verifyHitpayHmac(body: Record<string, string>): boolean {
  const salt = process.env.HITPAY_API_SALT;
  if (!salt) return false;
  const provided = body.hmac;
  if (!provided) return false;

  let toVerify = "";
  for (const key of Object.keys(body).sort()) {
    if (key === "hmac") continue;
    toVerify += `${key}${body[key] ?? ""}`;
  }
  const expected = createHmac("sha256", salt).update(toVerify).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
