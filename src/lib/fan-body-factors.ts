/**
 * Fan-body pricing factors — the multiplication / division factors applied to a
 * fabricated fan's body value (blade/type tag, material, blade material, custom
 * unit, double wall, wall-fan cage/stand, paint upgrade).
 *
 * These mirror the pricing logic in
 *   src/app/(app)/quotations/[id]/quotation-builder.tsx
 * (resolveTag, TAG_FACTORS, MATERIAL_FACTORS, bodyNetFrom, baseBodyOf, …). They
 * are duplicated here — verbatim — so the departmental P&L can apply the SAME
 * factors to a fan's body COGS on the server. IF YOU CHANGE A FACTOR IN THE
 * BUILDER, CHANGE IT HERE TOO (and vice-versa).
 *
 * The COGS table gives a base body cost per fan code (CEB / CIEB / TAF / PRV /
 * EWF·FAWF) and size; `fanBodyFactored(base, specs)` scales that base by exactly
 * the same pipeline the body price uses, so a Stainless / customized / double-
 * wall fan costs proportionally more.
 */

type Specs = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const b = (v: unknown): boolean => v === true || v === "true";
const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const PROPELLER_FAN_TYPES = new Set(["Exhaust Wall Fan", "Fresh Air Wall Fan", "Power Roof Ventilator", "Panel Fan"]);
const AXIAL_FAN_TYPES = new Set(["Tubeaxial", "Vaneaxial", "Customized Jet Fan"]);

/** Model-code tag by product type + blade type (see builder resolveTag). */
export function resolveTag(type: string, bladeType: string, category = ""): string {
  void category;
  if (AXIAL_FAN_TYPES.has(type)) return type === "Vaneaxial" ? "VAF" : type === "Customized Jet Fan" ? "JF" : "TAF";
  if (type === "Power Roof Ventilator") return "PRV";
  if (type === "Fresh Air Wall Fan") return "FAWF";
  if (PROPELLER_FAN_TYPES.has(type)) return "EWF";
  if (type === "Centrifugal Inline Blower") return "CIEB";
  if (type === "Square Inline Blower") return "SIEB";
  if (type === "Cabinet Blower (DIDW)") return /forward/i.test(bladeType) ? "CFABCAB" : "CEBCAB";
  if (type === "Centrifugal Blower (DIDW)" || type === "Double Inlet Double Width (DIDW)") return /forward/i.test(bladeType) ? "DIDWCFAB" : "DIDWCEB";
  if (type === "Cabinet Blower (SISW)") return "CABSISW";
  if (type === "High Pressure Blower") return "HPB";
  if (type === "Radial Blower" && bladeType === "Paddle Wheel") return "CMH";
  if (type === "Radial Blower" && bladeType === "Ring Paddle Wheel") return "CMA";
  if (type === "Radial Blower" && bladeType === "Backplate Paddle Wheel") return "CMB";
  if (type === "Plug Fan") return "CPF";
  if (/forward/i.test(bladeType)) return "CFAB";
  return "CEB";
}

/** The fan code (tag) for a line's specs — used to key the COGS table. */
export function fanTagOf(specs: Specs): string {
  return resolveTag(s(specs.type), s(specs.bladeType), s(specs.category));
}

const TAG_FACTORS: Record<string, number> = {
  CEB: 1, CIEB: 1, SIEB: 1, EWF: 1, EWFDD: 1, FAWF: 1, FAWFDD: 1, PRV: 1, PRVDD: 1,
  TAF: 1, TAFDD: 1, VAF: 1, VAFDD: 1, JF: 2, HPB: 1 / 0.4, CMH: 1, CMA: 1, CMB: 1, CPF: 1,
  CFAB: 1 / 0.9, CABSISW: 1 / 0.54, DIDWCEB: 1 / 0.57, DIDWCFAB: 1 / (0.9 * 0.57),
  CEBCAB: 1 / (0.57 * 0.54), CFABCAB: 1 / (0.9 * 0.57 * 0.9),
};
const tagFactor = (tag: string): number => TAG_FACTORS[tag] ?? 1;

const MATERIAL_FACTORS: Record<string, number> = {
  "Black Iron Sheet": 1, "Heavy Gauge Material": 1.25, "Aluminum Material": 3,
  "Fiberglas Reinforced Metal": 5.5, "Stainless 304 Material": 4, "Stainless 316 Material": 6, "Boiler Plate": 8,
  "Heavy gauge material": 1.25, "Fiberglass reinforced metal": 5.5, "Stainless 304 material": 4, "Stainless 316 material": 6,
};
const MATERIAL_CATEGORIES = new Set(["Centrifugal Type", "Axial Type", "Propeller Type", "Tubular Inline Type", "Cabinet Type"]);

const SPECIAL_BLADE_FACTOR: Record<string, number> = { "Reversible Blade": 1.5, Airfoil: 1.5 };
const specialBladeFactor = (specs: Specs): number => SPECIAL_BLADE_FACTOR[s(specs.bladeType)] ?? 1;
const bladeFactor = (specs: Specs): number => tagFactor(resolveTag(s(specs.type), s(specs.bladeType), s(specs.category)));

const PAINT_FACTORS: Record<string, number> = { "Powder Coated Finish": 0.5, "High Temperature Paint": 0.3 };
const BOTH_PAINTS = ["Powder Coated Finish", "High Temperature Paint"];
const PAINT_BY_MATERIAL: Record<string, string[]> = {
  "Black Iron Sheet": BOTH_PAINTS, "Heavy Gauge Material": BOTH_PAINTS, "Aluminum Material": BOTH_PAINTS,
  "Fiberglas Reinforced Metal": ["High Temperature Paint"], "Stainless 304 Material": [], "Stainless 316 Material": [], "Boiler Plate": BOTH_PAINTS,
};
const paintOptionsFor = (material: string): string[] => PAINT_BY_MATERIAL[material] ?? BOTH_PAINTS;
const paintFactor = (specs: Specs): number => {
  if (!b(specs.upgradePaint) || !paintOptionsFor(s(specs.material)).includes(s(specs.paintType))) return 0;
  return PAINT_FACTORS[s(specs.paintType)] ?? 0;
};

const DOUBLE_WALL_SURCHARGE = 0.46;
const CAGE_STAND_RATE = 300;
const WALL_FAN_ADDON_TYPES = new Set(["Fresh Air Wall Fan", "Exhaust Wall Fan"]);
function wallFanAddon(specs: Specs): number {
  if (!WALL_FAN_ADDON_TYPES.has(s(specs.type))) return 0;
  const dia = num(specs.inches);
  if (!(dia > 0)) return 0;
  const count = (b(specs.caged) ? 1 : 0) + (b(specs.fanStand) ? 1 : 0);
  return count * CAGE_STAND_RATE * dia;
}
function doubleWallApplies(specs: Specs): boolean {
  return b(specs.doubleWall) && s(specs.category) === "Cabinet Type";
}

/** Base body after the tag (blade/type) and special-blade factors. */
function baseBodyOf(base: number, specs: Specs): number {
  return base * bladeFactor(specs) * specialBladeFactor(specs);
}

/** Material / blade-material / customized / double-wall / addon / paint pipeline. */
function bodyNetFrom(base: number, specs: Specs): number {
  if (!MATERIAL_CATEGORIES.has(s(specs.category))) return base;
  const bodyMat = MATERIAL_FACTORS[s(specs.material)] ?? 1;
  let core: number;
  if (b(specs.bladeMaterialOn)) {
    const bladeMat = MATERIAL_FACTORS[s(specs.bladeMaterial)] ?? 1;
    core = base * 0.5 * bodyMat + base * 0.5 * bladeMat;
  } else {
    core = base * bodyMat;
  }
  if (b(specs.customizedUnit)) core *= 1.2;
  const dwFactor = doubleWallApplies(specs) ? 1 + DOUBLE_WALL_SURCHARGE : 1;
  core *= dwFactor;
  const addon = wallFanAddon(specs);
  return core + addon + (base + addon) * paintFactor(specs) * dwFactor;
}

/**
 * Scale a fan-body base value (catalogue price OR base COGS) by the full factor
 * pipeline for the given line specs — the same transform the body price uses.
 */
export function fanBodyFactored(base: number, specs: Specs): number {
  return bodyNetFrom(baseBodyOf(base, specs), specs);
}
