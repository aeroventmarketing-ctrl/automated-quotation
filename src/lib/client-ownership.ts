import { prisma } from "@/lib/db";

/**
 * Client ownership / "first contact wins" rules.
 *
 * A client contact is identified by four details, in priority order:
 *   1. company name   2. contact person   3. contact number   4. email address
 *
 * The company name is the mandatory key. An existing contact is considered the
 * SAME client — and therefore blocks a different salesperson — only when the
 * company matches AND at least one more detail (person, number, or email) also
 * matches. In short: two or more details the same, with company always one of
 * them:
 *   - same company + same person / number / email     -> matched (blocked)
 *   - same company + everything else different         -> not matched
 *   - different company (any details)                  -> not matched
 *
 * In case of dispute, whoever made the FIRST communication to that contact
 * (the earliest inquiry against the matching client) holds the authority to
 * assist them. Only that owner — or an admin — may log further inquiries.
 */

export function normalizePerson(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeCompany(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeEmail(v?: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

/** Phone comparison ignores spaces, dashes, parens and other non-digits. */
export function normalizePhone(v?: string | null): string {
  return (v ?? "").replace(/\D+/g, "");
}

export type ContactDetails = {
  company?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ContactOwner = {
  ownerId: string;
  ownerName: string;
  at: Date;
  company: string;
  contactName: string;
  /** Extra details (beyond company) that matched, in priority order. */
  matchedOn: string[];
  customerId: string;
};

/**
 * Find the first-contact owner for the given contact details. A match requires
 * the company name AND at least one of (contact person, number, email) to match
 * an existing contact. Returns the creator of the earliest inquiry across all
 * matching customers, or null when there is no company or no match.
 */
export async function findContactOwner(input: ContactDetails): Promise<ContactOwner | null> {
  const company = normalizeCompany(input.company);
  const person = normalizePerson(input.contactName);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  // Company is mandatory, plus at least one other detail to compare against.
  if (!company || (!person && !phone && !email)) return null;

  const customers = await prisma.customer.findMany({
    select: { id: true, company: true, contactName: true, phone: true, email: true },
  });

  const matched = new Map<string, { company: string; contactName: string; matchedOn: string[] }>();
  for (const c of customers) {
    if (normalizeCompany(c.company) !== company) continue;
    // Company already matches — now require at least one more detail to match.
    const on: string[] = [];
    if (person && normalizePerson(c.contactName) === person) on.push("contact person");
    if (phone && normalizePhone(c.phone) === phone) on.push("contact number");
    if (email && normalizeEmail(c.email) === email) on.push("email address");
    if (on.length === 0) continue;
    matched.set(c.id, {
      company: (c.company ?? "").trim(),
      contactName: (c.contactName ?? "").trim(),
      matchedOn: on,
    });
  }
  if (matched.size === 0) return null;

  // First communication = earliest inquiry across all matching customers.
  const first = await prisma.inquiry.findFirst({
    where: { customerId: { in: [...matched.keys()] } },
    orderBy: { createdAt: "asc" },
    select: { customerId: true, createdAt: true, createdBy: { select: { id: true, name: true } } },
  });
  if (!first) return null;

  const why = matched.get(first.customerId) ?? [...matched.values()][0];
  return {
    ownerId: first.createdBy.id,
    ownerName: first.createdBy.name,
    at: first.createdAt,
    company: why.company,
    contactName: why.contactName,
    matchedOn: why.matchedOn,
    customerId: first.customerId,
  };
}
