/**
 * The purchaser signatory printed on the Purchase Order's "Account Purchaser"
 * signature block — name, designation and an optional signature image. Mirrors
 * the 2307 payor signatory; stored in the AppSetting key/value table (no
 * migration) under its own key.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coerceSignatory, type Signatory } from "@/lib/signatory";

export const PURCHASER_SIGNATORY_KEY = "po_purchaser_signatory";

/** The saved purchaser signatory (all blanks if never configured). */
export async function getPurchaserSignatory(): Promise<Signatory> {
  const row = await prisma.appSetting.findUnique({ where: { key: PURCHASER_SIGNATORY_KEY } });
  return coerceSignatory(row?.value);
}

/** Save the purchaser signatory. */
export async function savePurchaserSignatory(input: Partial<Signatory>): Promise<Signatory> {
  const clean = coerceSignatory({ name: "", designation: "", signature: "", ...input });
  await prisma.appSetting.upsert({
    where: { key: PURCHASER_SIGNATORY_KEY },
    create: { key: PURCHASER_SIGNATORY_KEY, value: clean as unknown as Prisma.InputJsonValue },
    update: { value: clean as unknown as Prisma.InputJsonValue },
  });
  return clean;
}
