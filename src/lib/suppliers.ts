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
  address: string; // Address (for filing; not shown on the PO)
  tin: string; // Taxpayer Identification Number (for BIR 2307)
  zip: string; // ZIP Code (for BIR 2307)
  bankName: string; // Bank Name
  accountNumber: string; // Account Number
  ewt: boolean; // EWT capable — issuing a PO to this supplier defaults to "with EWT"
  // Gives us payment terms (we pay later, by check) rather than cash on purchase.
  // Owner's rule: *"Check is required for suppliers that give terms to us."* A PO
  // to a terms supplier is expected to carry a photo of the check once the check
  // is signed; one that doesn't is flagged to Accounting and the admin. Nothing
  // is blocked — it is a reminder, not a gate.
  //
  // Deliberately a flag on the SUPPLIER, not a reading of the PO's payment-terms
  // text: that text is free-form ("30 days upon delivery", "Payment via Cash /
  // GCASH / Online banking", "50% DP, 50% on delivery"), and guessing from it is
  // how you end up silently right most of the time and wrong on the deals that
  // matter. Whether a supplier gives us terms is a fact about the supplier.
  terms: boolean;
  remarks: string; // Default PO remark (e.g. payment terms) — auto-filled on the PO
}

/** The columns used for the import/export template (order matters). */
export const SUPPLIER_COLUMNS = [
  { key: "company", label: "Company Name" },
  { key: "contactPerson", label: "Contact Person" },
  { key: "contactNumber", label: "Contact Number" },
  { key: "email", label: "Email Address" },
  { key: "address", label: "Address" },
  { key: "tin", label: "TIN" },
  { key: "zip", label: "ZIP Code" },
  { key: "bankName", label: "Bank Name" },
  { key: "accountNumber", label: "Account Number" },
  { key: "ewt", label: "EWT Capable (yes/no)" },
  { key: "terms", label: "Gives Terms (yes/no)" },
  { key: "remarks", label: "Remarks" },
] as const;

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Parse a raw EWT value (boolean or a yes/no-ish string) into a tri-state:
 * true / false / undefined (undefined = not specified, so callers can preserve
 * an existing value on a partial import).
 */
export function parseEwt(v: unknown): boolean | undefined {
  return parseYesNo(v);
}

/**
 * Parse a raw boolean-ish cell (a real boolean, or "yes"/"no"/"1"/"0"/…) into a
 * tri-state: true / false / undefined. `undefined` means "not specified", so a
 * partial import preserves whatever the supplier already had rather than
 * silently resetting it to false.
 */
export function parseYesNo(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (["yes", "y", "true", "1", "with ewt", "with", "ewt", "ewt capable", "capable", "terms", "with terms"].includes(s)) return true;
  if (["no", "n", "false", "0", "without ewt", "without", "non-ewt", "not capable", "none", "cash", "no terms"].includes(s)) return false;
  return undefined;
}

/** The yes/no columns. They are matched before the free-text ones — see `mapSupplierHeaders`. */
export type SupplierBoolField = "ewt" | "terms";
export type SupplierStrField = Exclude<keyof Omit<Supplier, "id">, SupplierBoolField>;

const nk = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const STR_ALIASES: Record<SupplierStrField, string[]> = {
  company: ["company name", "company", "supplier", "supplier name"],
  contactPerson: ["contact person", "contact", "attention", "person", "contact name"],
  contactNumber: ["contact number", "contact no", "number", "phone", "mobile", "telephone", "tel"],
  email: ["email address", "email", "e-mail", "email add"],
  address: ["address", "location", "company address"],
  tin: ["tin", "taxpayer identification number", "taxpayer id", "tax id"],
  zip: ["zip code", "zip", "postal code", "postal"],
  bankName: ["bank name", "bank", "bank details", "bank name and account number", "payment details"],
  accountNumber: ["account number", "account no", "account #", "acct number", "acct no", "account"],
  remarks: ["remarks", "remark", "po remarks", "terms", "payment terms", "notes"],
};

/**
 * Each yes/no column, with an exact-alias list and a deliberately narrow
 * `contains` fallback.
 *
 * `terms` may NOT fall back on a bare `includes("terms")`: that also matches
 * "Payment Terms", which is a free-text remark, not a yes/no flag. It has to be
 * the two words together.
 */
const BOOL_ALIASES: Record<SupplierBoolField, { exact: string[]; contains: string[] }> = {
  ewt: {
    exact: ["ewt capable (yes/no)", "ewt capable", "ewt", "ewt capable?", "with ewt", "ewt?"],
    contains: ["ewt"],
  },
  terms: {
    exact: ["gives terms (yes/no)", "gives terms", "gives terms?", "gives us terms", "terms supplier", "with terms"],
    contains: ["gives terms", "gives us terms"],
  },
};

export type SupplierHeaderMap = Partial<Record<SupplierStrField, number>> & Partial<Record<SupplierBoolField, number>>;

/**
 * Map an imported header row to field → column index, using aliases (exact match
 * first, then `contains`).
 *
 * The yes/no columns are claimed FIRST and their indices are then off-limits to
 * the free-text search. Without that, "Gives Terms (yes/no)" is swallowed by
 * Remarks — whose aliases include "terms" and "payment terms" with a `contains`
 * fallback — and the flag silently imports as blank on every row. Silently: the
 * import reports success and every supplier reads "Cash".
 */
export function mapSupplierHeaders(headers: string[]): SupplierHeaderMap {
  const H = headers.map(nk);
  const map: SupplierHeaderMap = {};
  const taken = new Set<number>();
  const find = (pred: (h: string) => boolean) => H.findIndex((h, i) => !taken.has(i) && pred(h));

  for (const field of Object.keys(BOOL_ALIASES) as SupplierBoolField[]) {
    const { exact, contains } = BOOL_ALIASES[field];
    let idx = find((h) => exact.includes(h));
    if (idx < 0) idx = find((h) => contains.some((a) => h.includes(a)));
    if (idx >= 0) { map[field] = idx; taken.add(idx); }
  }
  // The free-text fields then search what's left. They do NOT claim columns from
  // each other — two of them landing on one header ("Bank Name and Account
  // Number") is long-standing behaviour and not what this is here to change.
  for (const field of Object.keys(STR_ALIASES) as SupplierStrField[]) {
    const aliases = STR_ALIASES[field];
    let idx = find((h) => aliases.includes(h));
    if (idx < 0) idx = find((h) => aliases.some((a) => h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

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
    address: String(o.address ?? "").trim(),
    tin: String(o.tin ?? "").trim(),
    zip: String(o.zip ?? "").trim(),
    // Legacy records stored the combined "paymentDetails" — carry it into Bank Name.
    bankName: String(o.bankName ?? o.paymentDetails ?? "").trim(),
    accountNumber: String(o.accountNumber ?? "").trim(),
    ewt: parseYesNo(o.ewt) ?? false,
    terms: parseYesNo(o.terms) ?? false,
    remarks: String(o.remarks ?? "").trim(),
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
  address?: string;
  tin?: string;
  zip?: string;
  bankName?: string;
  accountNumber?: string;
  ewt?: boolean;
  terms?: boolean;
  remarks?: string;
}

function normalizeInput(input: SupplierInput): Omit<Supplier, "id"> {
  return {
    company: (input.company ?? "").trim(),
    contactPerson: (input.contactPerson ?? "").trim(),
    contactNumber: (input.contactNumber ?? "").trim(),
    email: (input.email ?? "").trim(),
    address: (input.address ?? "").trim(),
    tin: (input.tin ?? "").trim(),
    zip: (input.zip ?? "").trim(),
    bankName: (input.bankName ?? "").trim(),
    accountNumber: (input.accountNumber ?? "").trim(),
    ewt: input.ewt ?? false,
    terms: input.terms ?? false,
    remarks: (input.remarks ?? "").trim(),
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

/** Remove several suppliers at once (by id). */
export async function deleteSuppliers(ids: string[]): Promise<Supplier[]> {
  const drop = new Set((ids ?? []).filter((x) => typeof x === "string" && x));
  const list = (await getSuppliers()).filter((s) => !drop.has(s.id));
  await writeSuppliers(list);
  return list;
}

/** Clear the whole supplier directory (so a fresh Excel/CSV can be imported). */
export async function clearSuppliers(): Promise<Supplier[]> {
  await writeSuppliers([]);
  return [];
}

/**
 * A junk supplier name produced by importing a product export's "Suppliers"
 * cell (e.g. `RITE PRODUCTS INC. ₱8078.02` or `A ₱1; B ₱2`) as a company. A real
 * company name never contains a peso sign or a semicolon, so those mark it junk.
 */
export const isPricedSupplierName = (company: string): boolean => /[₱;]/.test(company);

/** Remove directory suppliers whose name carries a price / semicolon (import junk). */
export async function removeInvalidSuppliers(): Promise<{ removed: number; list: Supplier[] }> {
  const list = await getSuppliers();
  const keep = list.filter((s) => !isPricedSupplierName(s.company));
  const removed = list.length - keep.length;
  if (removed > 0) await writeSuppliers(keep);
  return { removed, list: coerceSuppliers({ list: keep }) };
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
        address: d.address || list[idx].address,
        tin: d.tin || list[idx].tin,
        zip: d.zip || list[idx].zip,
        bankName: d.bankName || list[idx].bankName,
        accountNumber: d.accountNumber || list[idx].accountNumber,
        // Booleans: preserve the existing flag when the import didn't specify one.
        ewt: raw.ewt ?? list[idx].ewt,
        terms: raw.terms ?? list[idx].terms,
        remarks: d.remarks || list[idx].remarks,
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
export async function rememberSupplier(input: { company: string; attention?: string; address?: string }): Promise<void> {
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
    address: (input.address ?? "").trim(),
    tin: "",
    zip: "",
    bankName: "",
    accountNumber: "",
    ewt: false,
    terms: false,
    remarks: "",
  });
  await writeSuppliers(list);
}
