import { prisma } from "@/lib/db";

/**
 * Client ownership / "first contact wins" rules.
 *
 * Company name is NOT unique — many entries may share a company. What is
 * unique to a client contact are the three details: contact person, contact
 * number, and email address. A salesperson may log several contacts under one
 * company, but each of those three details identifies a single client.
 *
 * In case of dispute, whoever made the FIRST communication to that contact
 * (the earliest inquiry that touches the detail) holds the authority to assist
 * that client. Only that owner — or an admin — may log further inquiries
 * against a matching contact.
 */

export function normalizePerson(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeEmail(v?: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

/** Phone comparison ignores spaces, dashes, parens and a leading +/0 country prefix noise. */
export function normalizePhone(v?: string | null): string {
  return (v ?? "").replace(/\D+/g, "");
}

export type ContactDetails = {
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type ContactOwner = {
  ownerId: string;
  ownerName: string;
  at: Date;
  /** Which detail matched: "email" | "phone" | "contact person". */
  matchedOn: string;
  matchedValue: string;
  customerId: string;
};

/**
 * Find the first-contact owner for the given contact details, if any existing
 * contact in the system matches on email, phone, or contact person. Returns the
 * creator of the earliest inquiry across all customers that share a matching
 * detail, or null when the contact is brand new.
 */
export async function findContactOwner(input: ContactDetails): Promise<ContactOwner | null> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const person = normalizePerson(input.contactName);
  if (!email && !phone && !person) return null;

  const customers = await prisma.customer.findMany({
    select: { id: true, contactName: true, email: true, phone: true },
  });

  // Each matched customer records why it matched (strongest key first).
  const matched = new Map<string, { matchedOn: string; matchedValue: string }>();
  for (const c of customers) {
    if (email && normalizeEmail(c.email) === email) {
      matched.set(c.id, { matchedOn: "email", matchedValue: (c.email ?? "").trim() });
      continue;
    }
    if (phone && normalizePhone(c.phone) === phone) {
      matched.set(c.id, { matchedOn: "phone", matchedValue: (c.phone ?? "").trim() });
      continue;
    }
    if (person && normalizePerson(c.contactName) === person) {
      matched.set(c.id, { matchedOn: "contact person", matchedValue: (c.contactName ?? "").trim() });
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
    matchedOn: why.matchedOn,
    matchedValue: why.matchedValue,
    customerId: first.customerId,
  };
}
