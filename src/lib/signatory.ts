/**
 * The payor signatory printed on the BIR 2307 (the person who signs "over Printed
 * Name of Payor"). Holds the name, title/designation and an optional signature
 * image (a data URL). Stored in the AppSetting key/value table (no migration).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SIGNATORY_KEY = "po_2307_signatory";

export interface Signatory {
  name: string;
  designation: string;
  /** Signature image as a data URL (data:image/png;base64,…) or "" if none. */
  signature: string;
}

const EMPTY: Signatory = { name: "", designation: "", signature: "" };

/** Coerce raw AppSetting JSON into a clean Signatory. */
export function coerceSignatory(value: unknown): Signatory {
  if (!value || typeof value !== "object") return { ...EMPTY };
  const o = value as Record<string, unknown>;
  const signature = String(o.signature ?? "");
  return {
    name: String(o.name ?? "").trim(),
    designation: String(o.designation ?? "").trim(),
    signature: signature.startsWith("data:image/") ? signature : "",
  };
}

/** The saved payor signatory (all blanks if never configured). */
export async function getSignatory(): Promise<Signatory> {
  const row = await prisma.appSetting.findUnique({ where: { key: SIGNATORY_KEY } });
  return coerceSignatory(row?.value);
}

/** Save the payor signatory. */
export async function saveSignatory(input: Partial<Signatory>): Promise<Signatory> {
  const clean = coerceSignatory({ ...EMPTY, ...input });
  await prisma.appSetting.upsert({
    where: { key: SIGNATORY_KEY },
    create: { key: SIGNATORY_KEY, value: clean as unknown as Prisma.InputJsonValue },
    update: { value: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}
