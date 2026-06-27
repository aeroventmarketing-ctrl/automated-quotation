import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";

/** Footer note shown under the KDK quotation ("Note: ..."). */
export const KDK_NOTE = "All units are made of high quality materials.";

/**
 * Ensure the built-in "KDK" quotation template exists and carries the KDK terms
 * and footer note. Created once if missing; for an existing template, only
 * missing fields (terms / specNote) are filled in — present values (admin edits)
 * are never overwritten. Safe to call on any page load.
 */
export async function ensureKdkTemplate(): Promise<void> {
  const baseConfig = {
    accent: "#1d4ed8",
    showSpecs: true,
    showTerms: true,
    terms: COMPANY.kdkTerms,
    specNote: KDK_NOTE,
  };
  const existing = await prisma.quotationTemplate.findUnique({ where: { layoutKey: "kdk" } });
  if (!existing) {
    await prisma.quotationTemplate.create({
      data: { layoutKey: "kdk", name: "KDK", config: baseConfig, active: true },
    });
    return;
  }
  // Backfill terms / note only when absent, preserving any admin edits.
  const config = (existing.config as Record<string, unknown>) ?? {};
  const patch: Record<string, unknown> = { ...config };
  let changed = false;
  if (typeof config.terms !== "string" || !config.terms) {
    patch.terms = COMPANY.kdkTerms;
    changed = true;
  }
  if (typeof config.specNote !== "string" || !config.specNote) {
    patch.specNote = KDK_NOTE;
    changed = true;
  }
  if (changed) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "kdk" },
      data: { config: patch as Prisma.InputJsonObject },
    });
  }
}
