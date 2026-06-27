import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";

/**
 * Ensure the built-in "KDK" quotation template exists (VAT-inclusive KDK terms).
 * Created once if missing and never overwritten, so admin edits are preserved.
 * Safe to call on any page load — a single keyed lookup, write only on first run.
 */
export async function ensureKdkTemplate(): Promise<void> {
  const existing = await prisma.quotationTemplate.findUnique({ where: { layoutKey: "kdk" } });
  if (existing) return;
  await prisma.quotationTemplate.create({
    data: {
      layoutKey: "kdk",
      name: "KDK",
      config: { accent: "#1d4ed8", showSpecs: true, showTerms: true, terms: COMPANY.kdkTerms },
      active: true,
    },
  });
}
