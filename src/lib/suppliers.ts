/**
 * Saved supplier directory. Every time a purchaser issues a Purchase Order, the
 * supplier (company / attention / address) is remembered here so it can be picked
 * again next time — no separate data entry. Stored in the AppSetting key/value
 * table (no schema migration), deduped by company name (case-insensitive).
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SUPPLIERS_KEY = "suppliers";

export interface Supplier {
  id: string;
  company: string;
  attention: string;
  address: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Coerce raw AppSetting JSON into a clean, sorted supplier list. */
export function coerceSuppliers(value: unknown): Supplier[] {
  const raw = (value as { list?: unknown } | null)?.list;
  if (!Array.isArray(raw)) return [];
  const out: Supplier[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const company = String(o.company ?? "").trim();
    if (!company) continue;
    out.push({
      id: String(o.id ?? randomUUID()),
      company,
      attention: String(o.attention ?? "").trim(),
      address: String(o.address ?? "").trim(),
    });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
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

/** Add or edit a supplier by id (or dedup by company when adding a new one). */
export async function saveSupplier(input: {
  id?: string;
  company: string;
  attention?: string;
  address?: string;
}): Promise<Supplier[]> {
  const company = (input.company ?? "").trim();
  if (!company) throw new Error("Company name is required.");
  const attention = (input.attention ?? "").trim();
  const address = (input.address ?? "").trim();

  const list = await getSuppliers();
  if (input.id) {
    const idx = list.findIndex((s) => s.id === input.id);
    if (idx >= 0) list[idx] = { id: input.id, company, attention, address };
    else list.push({ id: input.id, company, attention, address });
  } else {
    const idx = list.findIndex((s) => norm(s.company) === norm(company));
    if (idx >= 0) list[idx] = { ...list[idx], company, attention, address };
    else list.push({ id: randomUUID(), company, attention, address });
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

/**
 * Remember a supplier from a saved PO. Matches an existing entry by company name
 * (case-insensitive) and refreshes its attention/address; otherwise adds it.
 * No-op when the company name is blank.
 */
export async function rememberSupplier(input: { company: string; attention?: string; address?: string }): Promise<void> {
  const company = (input.company ?? "").trim();
  if (!company) return;
  const attention = (input.attention ?? "").trim();
  const address = (input.address ?? "").trim();

  const list = await getSuppliers();
  const idx = list.findIndex((s) => norm(s.company) === norm(company));
  if (idx >= 0) {
    list[idx] = { ...list[idx], company, attention: attention || list[idx].attention, address: address || list[idx].address };
  } else {
    list.push({ id: randomUUID(), company, attention, address });
  }
  await writeSuppliers(list);
}
