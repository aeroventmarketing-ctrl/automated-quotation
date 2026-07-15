/**
 * Saved supplier payment terms (e.g. "Payment via Cash / GCASH / Online banking",
 * "30 days upon delivery", "50% DP, 50% on delivery"). Reusable on the supplier
 * Purchase Order. Stored in the AppSetting key/value table (no migration), deduped
 * by text (case-insensitive).
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const PAYMENT_TERMS_KEY = "payment_terms";

export interface PaymentTerm {
  id: string;
  text: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Coerce raw AppSetting JSON into a clean, sorted payment-term list. */
export function coercePaymentTerms(value: unknown): PaymentTerm[] {
  const raw = (value as { list?: unknown } | null)?.list;
  if (!Array.isArray(raw)) return [];
  const out: PaymentTerm[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    if (!text) continue;
    out.push({ id: String(o.id ?? randomUUID()), text });
  }
  return out.sort((a, b) => a.text.localeCompare(b.text));
}

/** The saved payment-term list. */
export async function getPaymentTerms(): Promise<PaymentTerm[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: PAYMENT_TERMS_KEY } });
  return coercePaymentTerms(row?.value);
}

async function writePaymentTerms(list: PaymentTerm[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: PAYMENT_TERMS_KEY },
    create: { key: PAYMENT_TERMS_KEY, value: { list } as unknown as Prisma.InputJsonValue },
    update: { value: { list } as unknown as Prisma.InputJsonValue },
  });
}

/** Add or edit a payment term (dedup by text when adding a new one). */
export async function savePaymentTerm(input: { id?: string; text: string }): Promise<PaymentTerm[]> {
  const text = (input.text ?? "").trim();
  if (!text) throw new Error("Payment term is required.");

  const list = await getPaymentTerms();
  if (input.id) {
    const idx = list.findIndex((t) => t.id === input.id);
    if (idx >= 0) list[idx] = { id: input.id, text };
    else list.push({ id: input.id, text });
  } else if (!list.some((t) => norm(t.text) === norm(text))) {
    list.push({ id: randomUUID(), text });
  }
  await writePaymentTerms(list);
  return coercePaymentTerms({ list });
}

/** Remove a payment term. */
export async function deletePaymentTerm(id: string): Promise<PaymentTerm[]> {
  const list = (await getPaymentTerms()).filter((t) => t.id !== id);
  await writePaymentTerms(list);
  return list;
}
