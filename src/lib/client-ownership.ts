import { prisma } from "@/lib/db";

/**
 * Client ownership / "first contact wins" rules.
 *
 * A client contact is identified by the pair (company name + contact person).
 * Neither alone blocks — only the combination does:
 *   - same company + same person   -> matched (blocked for a different owner)
 *   - same company + different person -> not matched
 *   - different company + same person -> not matched
 *   - different company + different person -> not matched
 *
 * In case of dispute, whoever made the FIRST communication to that contact
 * (the earliest inquiry against the matching pair) holds the authority to
 * assist that client. Only that owner — or an admin — may log further
 * inquiries against a matching contact.
 */

export function normalizePerson(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeCompany(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export type ContactDetails = {
  company?: string | null;
  contactName?: string | null;
};

export type ContactOwner = {
  ownerId: string;
  ownerName: string;
  at: Date;
  /** The matched company + person pair. */
  company: string;
  contactName: string;
  customerId: string;
};

/**
 * Find the first-contact owner for the given (company + person) pair, if any
 * existing contact matches on BOTH. Returns the creator of the earliest
 * inquiry across all customers that share the pair, or null when the pair is
 * incomplete or brand new.
 */
export async function findContactOwner(input: ContactDetails): Promise<ContactOwner | null> {
  const company = normalizeCompany(input.company);
  const person = normalizePerson(input.contactName);
  // Both parts of the pair are required — a lone company or a lone name never blocks.
  if (!company || !person) return null;

  const customers = await prisma.customer.findMany({
    select: { id: true, company: true, contactName: true },
  });

  const matched = new Map<string, { company: string; contactName: string }>();
  for (const c of customers) {
    if (normalizeCompany(c.company) === company && normalizePerson(c.contactName) === person) {
      matched.set(c.id, { company: (c.company ?? "").trim(), contactName: (c.contactName ?? "").trim() });
    }
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
    customerId: first.customerId,
  };
}
