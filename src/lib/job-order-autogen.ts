/**
 * Auto-generate production job orders from a paid quotation's line items. When an
 * order's payment is cleared it moves to "For JO creation"; instead of the
 * engineer building each job order by hand, we pre-populate them from the
 * quotation lines so they only need to review, set the due date, edit and approve.
 *
 * Phase 1 covers the two cleanly-mappable departments — Motor Controller and
 * Accessories (incl. spring vibration isolators). Fans & Blowers and Duct are
 * table-driven and are populated in a later phase; the engineer still adds those
 * manually for now.
 */
import { coerceAccessoriesJobOrder, type AccessoriesJobOrder, type AccessoryLine, type AccessoryDimension } from "@/lib/accessories-job-order";
import { coerceMotorControllerJobOrder, type MotorControllerJobOrder, type MotorControllerLine } from "@/lib/motor-controller-job-order";
import { coerceDuctJobOrder, EMPTY_DUCT_SEGMENT, isDamperType, type DuctJobOrder, type DuctSegment } from "@/lib/duct-job-order";
import { coerceFansJobOrder, joProjectCodes, type FansJobOrder } from "@/lib/job-order";
import { fanTagOf } from "@/lib/fan-body-factors";
import { findFanMotorHp } from "@/lib/fan-motor-table";

/** Air Duct quotation types — they map 1:1 to the Duct JO segment types. */
const AIR_DUCT_TYPES = new Set([
  "Straight Duct", "Duct Connector", "Duct Reducer", "Elbow Duct",
  "Offset Duct", "R-Duct", "Square to Round Duct", "Y-Duct",
]);
const isAirDuct = (s: Record<string, unknown>) =>
  s.category === "Ventilation Accessories" && AIR_DUCT_TYPES.has(str(s.type));
// Dampers are a Ventilation Accessory group but are fabricated by the DUCT
// department, not Accessories — they generate a Duct job order.
const isDamper = (s: Record<string, unknown>) =>
  s.category === "Ventilation Accessories" && isDamperType(str(s.type));
// Duct hardware — Duct Angle corner, TDC Cleat, S-clip, C-clip — is produced by
// Fans & Blowers straight to stock and is always on hand, so it never generates a
// job order (it's issued from inventory). Vent Cap is bought-in from a supplier —
// also no job order. Neither marks a fabricating department.
const isDuctHardware = (s: Record<string, unknown>) =>
  s.category === "Ventilation Accessories" && /^(duct angle corner|tdc cleat|s-clip|c-clip)$/i.test(str(s.type));
const isVentCap = (s: Record<string, unknown>) =>
  s.category === "Ventilation Accessories" && /^vent cap$/i.test(str(s.type));
const isNoJobOrderAccessory = (s: Record<string, unknown>) => isVentCap(s) || isDuctHardware(s);

/** Map a quotation Air Duct material to a Duct JO material. */
function ductMaterial(s: Record<string, unknown>): string {
  const m = str(s.material);
  if (/galvani/i.test(m)) return "G.I. Material";
  return m || "G.I. Material";
}

/** mm per one entered size unit (matches the quotation duct calculator's trade
 *  ratio — inches use 25, not 25.4). */
const ACC_MM_PER_UNIT: Record<string, number> = { mm: 1, cm: 10, inches: 25 };

/** Quotation duct gauge ("18", "18 ga", 20…) → Duct JO gauge option ("GA18"). */
function ductGaugeLabel(s: Record<string, unknown>): string {
  const g = str(s.gauge).replace(/[^0-9]/g, "");
  return g ? `GA${g}` : "GA20";
}

/**
 * Straight Duct standard section length, expressed in the entered size unit so it
 * lines up with the Width/Height numbers. Flanged bodies are 1.1 m, no-flange 1.2 m.
 */
function straightDuctLength(s: Record<string, unknown>): string {
  const unit = str(s.sizeUnit) || "inches";
  const perUnit = ACC_MM_PER_UNIT[unit] ?? 25;
  const stdMm = (s.ductNoFlange === true ? 1.2 : 1.1) * 1000;
  if (!perUnit) return "";
  return String(Math.round((stdMm / perUnit) * 100) / 100);
}

/** The subset of a quotation item the generator reads. */
export interface QuoteItemLike {
  qty: number;
  descriptionSnapshot: string;
  specsSnapshot: unknown;
}

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

function specsOf(it: QuoteItemLike): Record<string, unknown> {
  return (it.specsSnapshot && typeof it.specsSnapshot === "object" ? it.specsSnapshot : {}) as Record<string, unknown>;
}

const isMotorController = (s: Record<string, unknown>) => s.type === "Motor Controller";
const isIsolator = (s: Record<string, unknown>) => s.type === "Spring Vibration Isolator";
// Accessories = ventilation accessories EXCEPT the Air Duct group and dampers
// (both go to the Duct JO) and EXCEPT spring vibration isolators (not a job-order
// product).
const isAccessory = (s: Record<string, unknown>) =>
  s.category === "Ventilation Accessories" && !isAirDuct(s) && !isDamper(s) && !isNoJobOrderAccessory(s) && !isIsolator(s);

/**
 * The two labelled dimensions for an accessory line, carried across from the
 * quotation's sized fields (sizeL × sizeW in sizeUnit) — the same width/length
 * a grille, diffuser or louver is quoted with. A round terminal carries a single
 * Ø dimension. Values only; the engineer labels them (e.g. "Neck size"). Returns
 * two blanks when the line has no entered size.
 */
function accessoryDimensions(s: Record<string, unknown>): AccessoryDimension[] {
  const unit = str(s.sizeUnit) || "mm";
  const l = str(s.sizeL);
  const w = str(s.sizeW);
  const blank: AccessoryDimension = { value: "", label: "" };
  if (str(s.shape) === "Round") {
    return [l ? { value: `Ø${l} ${unit}`, label: "" } : blank, blank];
  }
  return [l ? { value: `${l} ${unit}`, label: "" } : blank, w ? { value: `${w} ${unit}`, label: "" } : blank];
}
// A fan/blower line: any non-accessory, non-motor-controller product with a fan
// category (Centrifugal / Axial / Propeller / Tubular…). Accessories are excluded.
// Fan/blower categories: Centrifugal / Axial / Propeller / Tubular Inline /
// Cabinet Type (plus panel/roof/blower/fan wording as a safety net).
const isFan = (s: Record<string, unknown>) => {
  const cat = str(s.category).toLowerCase();
  if (isMotorController(s) || isAccessory(s)) return false;
  // Bought-in / resale goods live under "Other Products" (KDK, AlphaAir, Wind
  // Driven Roof Ventilator, …). They're purchased, not fabricated, so they never
  // produce a job order — even when the name contains "roof"/"fan" wording.
  if (str(s.category) === "Other Products") return false;
  return /centrifugal|axial|propeller|tubular|cabinet|panel|roof|blower|fan/.test(cat + " " + str(s.type).toLowerCase());
};

/**
 * Which Fans & Blowers JO template one piece of text describes, or null when it
 * says nothing useful. Owner-confirmed pairings:
 *
 *   axial   → TAF / VAF      (Tubeaxial / Vaneaxial)
 *   inline  → CIEB           (Centrifugal Inline Blower)
 *   wall fan→ EWF / EWFDD, FAF / FAFDD — built on the Panel Fan sheet
 *   roof    → PRV / PRVDD
 *
 * `axial` is tested before `inline` so a *Tubeaxial* keeps its own template
 * even where both words are in play.
 */
function joTypeFromText(text: string): string | null {
  if (text.includes("didw")) return "centrifugal_blower_didw";
  if (text.includes("axial")) return "tubeaxial_vaneaxial";
  if (text.includes("inline")) return "centrifugal_inline_blower";
  if (text.includes("panel") || text.includes("wall fan")) return "panel_fan";
  if (text.includes("roof")) return "power_roof";
  return null;
}

/**
 * Map a quotation fan line to one of the Fans & Blowers JO templates.
 *
 * The **type** decides; the category is only consulted when the type says
 * nothing (e.g. "Customized Jet Fan" under "Axial Type"). Reading both at once
 * let a category outvote the product it contains: "Tubular Inline Type" +
 * *Tubeaxial* produced a Centrifugal Inline Blower — a CIEB sheet for a TAF.
 */
function fanJoType(s: Record<string, unknown>): string {
  const fromType = joTypeFromText(str(s.type).toLowerCase());
  if (fromType) return fromType;
  return joTypeFromText(str(s.category).toLowerCase()) ?? "centrifugal_blower";
}

/**
 * The Fans JO "Project" cell — a fan-code dropdown on the sheet.
 *
 * The code comes from `resolveTag`, the same function that builds the model
 * code (AV4800**EWF**3K3F3T) and keys the body-cost table, so the job order and
 * the quotation can't disagree about what the unit is. It used to be scanned
 * out of the model *string* against a hardcoded list of six centrifugal codes,
 * which left every non-centrifugal job order blank.
 *
 * The value must be one the sheet's dropdown offers, or it fails Excel's data
 * validation. Seven products have a code no sheet lists — JF, SIEB, HPB, CMH,
 * CMA, CMB and CPF — and for those the sheet's **base** code is used, because
 * that is the only thing an engineer could pick from the dropdown anyway:
 * owner-confirmed, JF sits on the TAF/VAF sheet, SIEB on CIEB, and HPB, CMH,
 * CMA, CMB and CPF on CEB.
 *
 * A direct-drive unit carries a "DD" suffix on its code — CEB → CEBDD — for
 * every family, which is exactly what the edit form does when Direct is ticked.
 */
function fanProjectCode(s: Record<string, unknown>, joType: string, isDirect: boolean): string {
  const tag = fanTagOf(s);
  if (!tag) return "";
  const offered = joProjectCodes(joType);
  const chosen = offered.includes(tag) ? tag : offered[0];
  return isDirect ? `${chosen}DD` : chosen;
}

/** The four mappable production departments. */
export type JobOrderDept = "fans" | "duct" | "accessories" | "motor";

/**
 * Which departments the paid quotation actually has fabricable items for — used
 * to hide job-order sections for departments the order doesn't touch. Mirrors the
 * exact classification `buildAutoJobOrders` uses (duct → fan → motor / accessory),
 * including the VFD exclusion (variable-frequency drives are bought-in, so they
 * produce no Motor Controller job order).
 */
export function quotationJobOrderDepts(items: QuoteItemLike[]): Record<JobOrderDept, boolean> {
  const depts: Record<JobOrderDept, boolean> = { fans: false, duct: false, accessories: false, motor: false };
  for (const it of items) {
    const s = specsOf(it);
    if (isAirDuct(s) || isDamper(s)) { depts.duct = true; continue; }
    // Duct hardware (produced to stock, no JO) and Vent Cap (bought-in) never
    // mark a job-order department.
    if (isNoJobOrderAccessory(s)) continue;
    if (isFan(s)) { depts.fans = true; continue; }
    if (isMotorController(s)) {
      if (!/variable frequency|vfd/i.test(str(s.bladeType))) depts.motor = true;
    } else if (isAccessory(s)) {
      depts.accessories = true;
    }
  }
  return depts;
}

export interface AutoJobOrders {
  fans: FansJobOrder[];
  duct: DuctJobOrder[];
  accessories: AccessoriesJobOrder[];
  motor: MotorControllerJobOrder[];
}

/**
 * Build the auto-populated job orders for the mappable departments. Returns one
 * job order per department (with a line per matching quotation item), or an empty
 * list for a department with no matching lines. Job numbers are left blank — they
 * are claimed from the running counter and formatted (with the a/b/c suffix) when
 * the workflow is saved / rendered, exactly like a manually-added job order.
 */
export function buildAutoJobOrders(
  items: QuoteItemLike[],
  opts: { project: string; date: string; motorBrand?: string; orderNumber?: string },
): AutoJobOrders {
  // Admin-set default motor brand (varies with product availability).
  const motorBrand = opts.motorBrand === "Hyundai" ? "Hyundai" : "TECO";
  const motorLines: MotorControllerLine[] = [];
  const accessoryLines: AccessoryLine[] = [];
  const ductSegments: DuctSegment[] = [];
  const fans: FansJobOrder[] = [];

  for (const it of items) {
    const s = specsOf(it);
    const qty = it.qty > 0 ? String(it.qty) : "1";
    if (isDamper(s)) {
      // A damper is produced by the Duct department — one Duct segment per line,
      // carrying its type and sized dimensions (dampers have no run length).
      ductSegments.push({
        ...EMPTY_DUCT_SEGMENT,
        type: str(s.type) || "Volume Damper",
        quantity: qty,
        uom: "pc",
        horizontal: str(s.sizeL),
        vertical: str(s.sizeW),
        length: "",
        unit: str(s.sizeUnit) || "inches",
        material: ductMaterial(s),
        gauge: ductGaugeLabel(s),
      });
      continue;
    }
    if (isAirDuct(s)) {
      // One duct segment per quotation Air Duct line. The quotation calculator
      // stores the cross-section as Width "A" = ductCalcWidth and Height "B" =
      // ductCalcLength (the field names are historical). Map them straight across:
      //   Horizontal ← Width "A", Vertical ← Height "B".
      // Length: a Straight Duct / Duct Connector uses the standard section length
      // (1.1 m flanged / 1.2 m no-flange); an Offset Duct carries its own "L" in
      // ductCalcHeight. Reducer-like types have no single length, left for the
      // engineer. The reducer "reduces-to" sizes aren't captured on the quote.
      const type = str(s.type) || "Straight Duct";
      const isStraight = type === "Straight Duct" || type === "Duct Connector";
      ductSegments.push({
        ...EMPTY_DUCT_SEGMENT,
        type,
        quantity: qty,
        uom: "pc",
        horizontal: str(s.ductCalcWidth),
        vertical: str(s.ductCalcLength),
        length: isStraight ? straightDuctLength(s) : type === "Offset Duct" ? str(s.ductCalcHeight) : "",
        toHorizontal: "",
        toVertical: "",
        unit: str(s.sizeUnit) || "inches",
        material: ductMaterial(s),
        gauge: ductGaugeLabel(s),
      });
      continue;
    }
    if (isFan(s)) {
      // One Fans & Blowers JO per fan line. Populate the descriptive/geometry
      // fields that map directly from the quotation; the motor-table, pulley,
      // RPM and lead-time fields stay blank for the engineer to complete.
      const cfm = str(s.capacity_cfm);
      const sp = str(s.staticPressure_inwg) || str(s.staticPressure_pa);
      const isDirect = /direct/i.test(str(s.drive));
      const joType = fanJoType(s);
      // Motor cascade (admin-set brand default): brand → phase label → HP key.
      const phaseTok = str(s.motorPh).startsWith("1") ? "1PH" : "3PH";
      const motorPhAlias = phaseTok === "1PH" ? "Single Phase" : "Three Phase";
      const motorHp = str(s.motorHp) ? findFanMotorHp(motorBrand, phaseTok, str(s.motorHp)) : "";
      fans.push({
        ...(coerceFansJobOrder({}) as FansJobOrder),
        type: joType,
        date: opts.date,
        // Project = fan code from the model (matches the JO's Project dropdown).
        project: fanProjectCode(s, joType, isDirect),
        make: str(s.make) || "Standard",
        quantity: qty,
        // UOM option values differ by template (centrifugal uses "pcs", the
        // others "pcs.").
        uom: joType === "centrifugal_blower" || joType === "centrifugal_blower_didw" ? "pcs" : "pcs.",
        bladeDiameter: str(s.inches),
        bladeType: str(s.bladeType),
        driveType: str(s.drive) ? (isDirect ? "Direct" : "Belt") : "",
        directDrive: isDirect,
        orientation: str(s.orientation),
        rotation: str(s.rotation),
        capacity: cfm ? `${cfm} cfm${sp ? ` @ ${sp}" w.g.` : ""}` : "",
        rpmCatalogue: str(s.rpm),
        mounting: str(s.mounting),
        // Enclosure: EX motor → Explosion Proof, else TEFC. Frequency: PH standard.
        enclosure: s.exproof ? "Explosion Proof" : "TEFC",
        frequency: "60",
        voltage: str(s.motorVolts),
        // Motor: standard TECO brand; phase + HP cascade from the quotation.
        motorBrand,
        motorPhAlias,
        motorHp,
      });
      continue;
    }
    if (isMotorController(s)) {
      // VFD controllers are bought-in, not fabricated — they get no job order.
      // Only Motor Starters (DOL / Y-Δ / Y-YY, stored in `drive`) produce a JO.
      if (!/variable frequency|vfd/i.test(str(s.bladeType))) {
        motorLines.push({
          quantity: qty,
          uom: "pc",
          starterType: str(s.drive) || str(s.starterType),
          hp: str(s.motorHp),
          phase: str(s.motorPh) || "3",
          voltage: str(s.motorVolts),
          moreDetails: "",
        });
      }
    } else if (isAccessory(s)) {
      accessoryLines.push({
        type: str(s.type),
        quantity: qty,
        uom: "pc",
        // Carry the sized dimensions across from the quotation (grilles,
        // diffusers, louvers, …); the labels are left for the engineer to fill.
        dimensions: accessoryDimensions(s),
        material: str(s.material),
        note: "",
        moreDetails: "",
      });
    }
  }

  // Duct / Accessories / Motor Controller: put the order number in the Project
  // box for reference (Fans uses its own fan-code Project set, above).
  const header = { date: opts.date, project: (opts.orderNumber ?? opts.project ?? "").trim(), dueDate: "", note: "", assignedPersonnel: "" };
  const motor: MotorControllerJobOrder[] = motorLines.length
    ? [{ ...(coerceMotorControllerJobOrder({}) as MotorControllerJobOrder), ...header, lines: motorLines }]
    : [];
  const accessories: AccessoriesJobOrder[] = accessoryLines.length
    ? [{ ...(coerceAccessoriesJobOrder({}) as AccessoriesJobOrder), ...header, lines: accessoryLines }]
    : [];
  const duct: DuctJobOrder[] = ductSegments.length
    ? [{ ...(coerceDuctJobOrder({}) as DuctJobOrder), ...header, quantity: String(ductSegments.length), uom: "set", segments: ductSegments }]
    : [];

  return { fans, duct, accessories, motor };
}
