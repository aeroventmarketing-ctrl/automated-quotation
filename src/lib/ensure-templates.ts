import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";

/** Footer note shown under the KDK quotation ("Note: ..."). KDK is short. */
export const KDK_NOTE = "All units are made of high quality materials.";

/**
 * Quotation templates offered in the picker: the "Fans and Blowers" (standard)
 * layout, "Air Terminals and Ducts", and KDK. The Government / Detailed /
 * Budgetary / Export layouts are retired — matched by layoutKey so
 * admin-renamed display names still resolve.
 */
export const RETAINED_TEMPLATE_LAYOUT_KEYS = [
  "standard",
  "power_roof_ventilator",
  "wind_driven_roof_vent",
  "air_terminals",
  "kdk",
  "services",
] as const;

/**
 * Display order for the template picker: Fans and Blowers first (the default),
 * then Power Roof Ventilator, Wind Driven Roof Vent, Air Terminals and Ducts,
 * KDK, and Services last. Sorted by layoutKey so admin-renamed display names
 * keep their position; unknown keys fall to the end.
 */
export const TEMPLATE_PICKER_ORDER = [
  "standard",
  "power_roof_ventilator",
  "wind_driven_roof_vent",
  "air_terminals",
  "kdk",
  "services",
] as const;

export function sortTemplatesByPickerOrder<T extends { layoutKey: string }>(templates: T[]): T[] {
  const rank = (k: string) => {
    const i = (TEMPLATE_PICKER_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? TEMPLATE_PICKER_ORDER.length : i;
  };
  return [...templates].sort((a, b) => rank(a.layoutKey) - rank(b.layoutKey));
}

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
 * has its terms kept in sync with the code-defined terms (other config kept).
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
  // Keep the Air Terminals terms in sync with the code-defined terms so updates
  // here reach the live template (these terms are managed in config, not admin).
  const config = (existing.config as Record<string, unknown>) ?? {};
  if (config.terms !== COMPANY.airTerminalsTerms) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "air_terminals" },
      data: { config: { ...config, terms: COMPANY.airTerminalsTerms } as Prisma.InputJsonObject },
    });
  }
}

/**
 * Ensure the built-in "Fans and Blowers" (standard) quotation template exists
 * and carries the customer-facing name. Created once if missing. For an
 * existing template still holding the seed default name "Standard", the display
 * name is upgraded to "Fans and Blowers" — any other admin-set name is kept.
 */
export async function ensureStandardTemplate(): Promise<void> {
  const existing = await prisma.quotationTemplate.findUnique({ where: { layoutKey: "standard" } });
  if (!existing) {
    await prisma.quotationTemplate.create({
      data: {
        layoutKey: "standard",
        name: "Fans and Blowers",
        config: {
          accent: "#1d4ed8",
          showSpecs: true,
          showTerms: true,
          terms: COMPANY.defaultTerms,
          specNote: STANDARD_LONG_NOTE,
        },
        active: true,
      },
    });
    return;
  }
  if (existing.name === "Standard") {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "standard" },
      data: { name: "Fans and Blowers" },
    });
  }
}

/**
 * Ensure the built-in "Power Roof Ventilator" quotation template exists with its
 * terms and the standard fan/blower note. Created once if missing; an existing
 * template only has its terms kept in sync with the code-defined terms (other
 * config, e.g. an admin-set note, is preserved).
 */
export async function ensurePowerRoofVentilatorTemplate(): Promise<void> {
  const baseConfig = {
    accent: "#1d4ed8",
    showSpecs: true,
    showTerms: true,
    terms: COMPANY.powerRoofVentilatorTerms,
    specNote: STANDARD_LONG_NOTE,
  };
  const existing = await prisma.quotationTemplate.findUnique({
    where: { layoutKey: "power_roof_ventilator" },
  });
  if (!existing) {
    await prisma.quotationTemplate.create({
      data: { layoutKey: "power_roof_ventilator", name: "Power Roof Ventilator", config: baseConfig, active: true },
    });
    return;
  }
  // Keep the terms in sync with the code-defined terms so updates here reach the
  // live template (these terms are managed in config, not admin).
  const config = (existing.config as Record<string, unknown>) ?? {};
  if (config.terms !== COMPANY.powerRoofVentilatorTerms) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "power_roof_ventilator" },
      data: { config: { ...config, terms: COMPANY.powerRoofVentilatorTerms } as Prisma.InputJsonObject },
    });
  }
}

/**
 * Ensure the built-in "Services" quotation template exists with its terms (no
 * spec footer note — it's a labour/service quote). Created once if missing; an
 * existing template only has its terms kept in sync with the code-defined terms.
 */
export async function ensureServicesTemplate(): Promise<void> {
  const baseConfig = {
    accent: "#1d4ed8",
    showSpecs: true,
    showTerms: true,
    terms: COMPANY.servicesTerms,
    specNote: "",
  };
  const existing = await prisma.quotationTemplate.findUnique({ where: { layoutKey: "services" } });
  if (!existing) {
    await prisma.quotationTemplate.create({
      data: { layoutKey: "services", name: "Services", config: baseConfig, active: true },
    });
    return;
  }
  // Keep the terms in sync with the code-defined terms so updates here reach the
  // live template (these terms are managed in config, not admin).
  const config = (existing.config as Record<string, unknown>) ?? {};
  if (config.terms !== COMPANY.servicesTerms) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "services" },
      data: { config: { ...config, terms: COMPANY.servicesTerms } as Prisma.InputJsonObject },
    });
  }
}

/**
 * Ensure the built-in "Wind Driven Roof Vent" quotation template exists with its
 * terms (no spec footer note — the unit has no motor). Created once if missing;
 * an existing template only has its terms kept in sync with the code-defined terms.
 */
export async function ensureWindDrivenRoofVentTemplate(): Promise<void> {
  const baseConfig = {
    accent: "#1d4ed8",
    showSpecs: true,
    showTerms: true,
    terms: COMPANY.windDrivenRoofVentTerms,
    specNote: "",
  };
  const existing = await prisma.quotationTemplate.findUnique({
    where: { layoutKey: "wind_driven_roof_vent" },
  });
  if (!existing) {
    await prisma.quotationTemplate.create({
      data: { layoutKey: "wind_driven_roof_vent", name: "Wind Driven Roof Vent", config: baseConfig, active: true },
    });
    return;
  }
  // Keep the terms in sync with the code-defined terms so updates here reach the
  // live template (these terms are managed in config, not admin).
  const config = (existing.config as Record<string, unknown>) ?? {};
  if (config.terms !== COMPANY.windDrivenRoofVentTerms) {
    await prisma.quotationTemplate.update({
      where: { layoutKey: "wind_driven_roof_vent" },
      data: { config: { ...config, terms: COMPANY.windDrivenRoofVentTerms } as Prisma.InputJsonObject },
    });
  }
}

/** Ensure all built-in templates (Fans and Blowers + Power Roof Ventilator + Wind Driven Roof Vent + KDK + Air Terminals + Services) exist. */
export async function ensureBuiltinTemplates(): Promise<void> {
  await ensureStandardTemplate();
  await ensurePowerRoofVentilatorTemplate();
  await ensureWindDrivenRoofVentTemplate();
  await ensureKdkTemplate();
  await ensureAirTerminalsTemplate();
  await ensureServicesTemplate();
}
