import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";

/** Footer note shown under the KDK quotation ("Note: ..."). KDK is short. */
export const KDK_NOTE = "All units are made of high quality materials.";

/**
 * Quotation templates offered in the picker: the Standard "Fans & Blowers"
 * layout and KDK. The Government / Detailed / Budgetary / Export layouts are
 * retired — matched by layoutKey so admin-renamed display names still resolve.
 */
export const RETAINED_TEMPLATE_LAYOUT_KEYS = ["standard", "kdk", "air_terminals"] as const;

/** Short footer note for the Air Terminals and Ducts template. */
export const AIR_TERMINALS_NOTE = "All units are made of high quality materials.";

/**
 * The long Standard (Fans and Blowers) note. If it ever ended up on the KDK
 * template it is replaced with the short KDK note — but the Standard template
 * keeps it (the two templates have different notes by design).
 */
const STANDARD_LONG_NOTE =
  "All units are made of high quality materials. Designed and built for continuous duty operation. Statically and Dynamically balanced. Without installed Inlet Safety and Outlet Safety Screen as standard. Installed with TECO / TECO MONARCH / HYUNDAI TEFC Induction Motor.";

/**
 * Ensure the built-in "KDK" quotation template exists and carries the KDK terms
 * and short footer note. Created once if missing. For an existing KDK template,
 * missing terms are backfilled and the note is set to the short KDK note only
 * when absent or still holding the long Standard note — any other admin-set note
 * is preserved. Only the KDK template is touched; Standard is left alone.
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
  const config = (existing.config as Record<string, unknown>) ?? {};
  const patch: Record<string, unknown> = { ...config };
  let changed = false;
  if (typeof config.terms !== "string" || !config.terms) {
    patch.terms = COMPANY.kdkTerms;
    changed = true;
  }
  const note = typeof config.specNote === "string" ? config.specNote.trim() : "";
  if (!note || note === STANDARD_LONG_NOTE) {
    if (config.specNote !== KDK_NOTE) {
      patch.specNote = KDK_NOTE;
      changed = true;
    }
  }
  if (changed) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "kdk" },
      data: { config: patch as Prisma.InputJsonObject },
    });
  }
}

/**
 * Ensure the built-in "Air Terminals and Ducts" quotation template exists with
 * its terms and short note. Created once if missing; an existing template only
 * has missing terms backfilled (any admin-edited config is otherwise preserved).
 */
export async function ensureAirTerminalsTemplate(): Promise<void> {
  const baseConfig = {
    accent: "#1d4ed8",
    showSpecs: true,
    showTerms: true,
    terms: COMPANY.airTerminalsTerms,
    specNote: AIR_TERMINALS_NOTE,
  };
  const existing = await prisma.quotationTemplate.findUnique({ where: { layoutKey: "air_terminals" } });
  if (!existing) {
    await prisma.quotationTemplate.create({
      data: { layoutKey: "air_terminals", name: "Air Terminals and Ducts", config: baseConfig, active: true },
    });
    return;
  }
  const config = (existing.config as Record<string, unknown>) ?? {};
  if (typeof config.terms !== "string" || !config.terms) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "air_terminals" },
      data: { config: { ...config, terms: COMPANY.airTerminalsTerms } as Prisma.InputJsonObject },
    });
  }
}

/** Ensure all built-in templates (KDK + Air Terminals and Ducts) exist. */
export async function ensureBuiltinTemplates(): Promise<void> {
  await ensureKdkTemplate();
  await ensureAirTerminalsTemplate();
}
