/**
 * Saved supplier directory. Suppliers can be added/edited on the admin Suppliers
 * page (including bulk import from Excel/CSV) and are also remembered when a
 * purchaser issues a Purchase Order. Stored in the AppSetting key/value table
 * (no schema migration), deduped by company name (case-insensitive).
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SUPPLIERS_KEY = "suppliers";

export interface Supplier {
  id: string;
  company: string; // Company Name
  contactPerson: string; // Contact Person
  contactNumber: string; // Contact Number
  email: string; // Email Address
  paymentDetails: string; // Payment Details
}

/** The columns used for the import/export template (order matters). */
export const SUPPLIER_COLUMNS = [
  { key: "company", label: "Company Name" },
  { key: "contactPerson", label: "Contact Person" },
  { key: "contactNumber", label: "Contact Number" },
  { key: "email", label: "Email Address" },
  { key: "paymentDetails", label: "Payment Details" },
] as const;

const norm = (s: string) => s.trim().toLowerCase();

/** Coerce one raw record into a Supplier (tolerates the legacy attention/address shape). */
function coerceOne(r: unknown): Supplier | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const company = String(o.company ?? "").trim();
  if (!company) return null;
  return {
    id: String(o.id ?? randomUUID()),
    company,
    // Legacy records stored "attention"; carry it over into Contact Person.
    contactPerson: String(o.contactPerson ?? o.attention ?? "").trim(),
    contactNumber: String(o.contactNumber ?? "").trim(),
    email: String(o.email ?? "").trim(),
    paymentDetails: String(o.paymentDetails ?? "").trim(),
  };
}

/** Coerce raw AppSetting JSON into a clean, sorted supplier list. */
export function coerceSuppliers(value: unknown): Supplier[] {
  const raw = (value as { list?: unknown } | null)?.list;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(coerceOne)
    .filter((s): s is Supplier => s !== null)
    .sort((a, b) => a.company.localeCompare(b.company));
}

/** The saved supplier directory. */
export async function getSuppliers(): Promise<Supplier[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: SUPPLIERS_KEY } });
  return coerceSuppliers(row?.value);
}

async function writeSuppliers(list: Supplier[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SUPPLIERS_KEY },
    create: { key: SUPPLIERS_KEY, value: { list } as unknown as Prisma.InputJsonValue },
    update: { value: { list } as unknown as Prisma.InputJsonValue },
  });
}

export interface SupplierInput {
  id?: string;
  company: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  paymentDetails?: string;
}

function normalizeInput(input: SupplierInput): Omit<Supplier, "id"> {
  return {
    company: (input.company ?? "").trim(),
    contactPerson: (input.contactPerson ?? "").trim(),
    contactNumber: (input.contactNumber ?? "").trim(),
    email: (input.email ?? "").trim(),
    paymentDetails: (input.paymentDetails ?? "").trim(),
  };
}

/** Add or edit a supplier by id (or dedup by company when adding a new one). */
export async function saveSupplier(input: SupplierInput): Promise<Supplier[]> {
  const d = normalizeInput(input);
  if (!d.company) throw new Error("Company name is required.");

  const list = await getSuppliers();
  if (input.id) {
    const idx = list.findIndex((s) => s.id === input.id);
    if (idx >= 0) list[idx] = { id: input.id, ...d };
    else list.push({ id: input.id, ...d });
  } else {
    const idx = list.findIndex((s) => norm(s.company) === norm(d.company));
    if (idx >= 0) list[idx] = { ...list[idx], ...d };
    else list.push({ id: randomUUID(), ...d });
  }
  await writeSuppliers(list);
  return coerceSuppliers({ list });
}

/** Remove a supplier from the directory. */
export async function deleteSupplier(id: string): Promise<Supplier[]> {
  const list = (await getSuppliers()).filter((s) => s.id !== id);
  await writeSuppliers(list);
  return list;
}

export interface BulkResult {
  added: number;
  updated: number;
  skipped: number;
  list: Supplier[];
}

/**
 * Bulk add/update suppliers from an imported file. Rows are matched to existing
 * suppliers by company name (case-insensitive): a match is updated (only with the
 * non-blank values provided), otherwise a new supplier is added. Rows without a
 * company name are skipped.
 */
export async function bulkUpsertSuppliers(rows: SupplierInput[]): Promise<BulkResult> {
  const list = await getSuppliers();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of rows) {
    const d = normalizeInput(raw);
    if (!d.company) {
      skipped++;
      continue;
    }
    const idx = list.findIndex((s) => norm(s.company) === norm(d.company));
    if (idx >= 0) {
      // Merge: only overwrite a field when the import provides a non-blank value.
      list[idx] = {
        ...list[idx],
        company: d.company,
        contactPerson: d.contactPerson || list[idx].contactPerson,
        contactNumber: d.contactNumber || list[idx].contactNumber,
        email: d.email || list[idx].email,
        paymentDetails: d.paymentDetails || list[idx].paymentDetails,
      };
      updated++;
    } else {
      list.push({ id: randomUUID(), ...d });
      added++;
    }
  }

  await writeSuppliers(list);
  return { added, updated, skipped, list: coerceSuppliers({ list }) };
}

/**
 * Remember a supplier from a saved PO. Adds the company if it's new (carrying the
 * PO's "Attention" into Contact Person); never overwrites an existing record, so
 * details entered on the Suppliers page are preserved.
 */
export async function rememberSupplier(input: { company: string; attention?: string }): Promise<void> {
  const company = (input.company ?? "").trim();
  if (!company) return;
  const list = await getSuppliers();
  if (list.some((s) => norm(s.company) === norm(company))) return; // keep existing details
  list.push({
    id: randomUUID(),
    company,
    contactPerson: (input.attention ?? "").trim(),
    contactNumber: "",
    email: "",
    paymentDetails: "",
  });
  await writeSuppliers(list);
}
