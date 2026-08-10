/**
 * SMS reach stat for the Admin follow-up panel: of the clients the SMS channel
 * targets (those with an open, still-live SENT quote — the same universe the
 * runner scans), how many have a valid PH mobile number. "Valid" is decided by
 * the SAME normalizer the sender uses, so the count reflects exactly who a live
 * SMS run could actually reach.
 */
import { prisma } from "@/lib/db";
import { normalizePhMobile } from "@/lib/sms/semaphore";

export interface SmsReach {
  /** Distinct clients with an open sent quote (the SMS follow-up universe). */
  total: number;
  /** Of those, how many have a valid, textable PH mobile on file. */
  withMobile: number;
}

export async function getSmsReach(): Promise<SmsReach> {
  const quotes = await prisma.quotation.findMany({
    where: { status: "SENT", inquiry: { status: { notIn: ["WON", "LOST"] } } },
    select: { inquiry: { select: { customer: { select: { id: true, phone: true } } } } },
  });
  // One entry per client (a client may have several open quotes).
  const byCustomer = new Map<string, string | null>();
  for (const q of quotes) {
    const c = q.inquiry.customer;
    if (!byCustomer.has(c.id)) byCustomer.set(c.id, c.phone);
  }
  let withMobile = 0;
  for (const phone of byCustomer.values()) if (normalizePhMobile(phone)) withMobile++;
  return { total: byCustomer.size, withMobile };
}
