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
import { coerceAccessoriesJobOrder, type AccessoriesJobOrder, type AccessoryLine } from "@/lib/accessories-job-order";
import { coerceMotorControllerJobOrder, type MotorControllerJobOrder, type MotorControllerLine } from "@/lib/motor-controller-job-order";
import { coerceDuctJobOrder, EMPTY_DUCT_SEGMENT, type DuctJobOrder, type DuctSegment } from "@/lib/duct-job-order";
import { coerceFansJobOrder, type FansJobOrder } from "@/lib/job-order";
import { findFanMotorHp } from "@/lib/fan-motor-table";

/** Air Duct quotation types — they map 1:1 to the Duct JO segment types. */
const AIR_DUCT_TYPES = new Set([
  "Straight Duct", "Duct Connector", "Duct Reducer", "Elbow Duct",
  "Offset Duct", "R-Duct", "Square to Round Duct", "Y-Duct",
]);
const isAirDuct = (s: Record<string, unknown>) =>
  s.category === "Ventilation Accessories" && AIR_DUCT_TYPES.has(str(s.type));

/** Map a quotation Air Duct material to a Duct JO material. */
function ductMaterial(s: Record<string, unknown>): string {
  const m = str(s.material);
  if (/galvani/i.test(m)) return "G.I. Material";
  return m || "G.I. Material";
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
// Accessories = ventilation accessories EXCEPT the Air Duct group (those go to the
// Duct JO), plus spring vibration isolators.
const isAccessory = (s: Record<string, unknown>) =>
  (s.category === "Ventilation Accessories" && !isAirDuct(s)) || isIsolator(s);
// A fan/blower line: any non-accessory, non-motor-controller product with a fan
// category (Centrifugal / Axial / Propeller / Tubular…). Accessories are excluded.
// Fan/blower categories: Centrifugal / Axial / Propeller / Tubular Inline /
// Cabinet Type (plus panel/roof/blower/fan wording as a safety net).
const isFan = (s: Record<string, unknown>) => {
  const cat = str(s.category).toLowerCase();
  if (isMotorController(s) || isAccessory(s)) return false;
  return /centrifugal|axial|propeller|tubular|cabinet|panel|roof|blower|fan/.test(cat + " " + str(s.type).toLowerCase());
};

/** Map a quotation fan type/category to one of the Fans & Blowers JO templates. */
function fanJoType(s: Record<string, unknown>): string {
  const t = (str(s.type) + " " + str(s.category)).toLowerCase();
  if (t.includes("didw")) return "centrifugal_blower_didw";
  if (t.includes("inline")) return "centrifugal_inline_blower";
  if (t.includes("panel")) return "panel_fan";
  if (t.includes("roof")) return "power_roof";
  if (t.includes("axial")) return "tubeaxial_vaneaxial";
  return "centrifugal_blower";
}

// Fans JO "Project" is a fan-code dropdown; the code is embedded in the model
// (e.g. AV4025**CEB**15K3F2T → "CEB"). Longest first so combos win over prefixes.
const FAN_PROJECT_CODES = ["CFABCAB", "CABSISW", "CEBCAB", "CFAB", "CEB", "CAB"];
function fanProjectCode(s: Record<string, unknown>, description: string): string {
  const model = (str(s.model) || (/model:\s*([A-Za-z0-9]+)/i.exec(description)?.[1] ?? "")).toUpperCase();
  return FAN_PROJECT_CODES.find((c) => model.includes(c)) ?? "";
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
  opts: { project: string; date: string; motorBrand?: string },
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
    if (isAirDuct(s)) {
      // One duct segment per quotation Air Duct line. The cross-section
      // (width × height) and length come from the duct calculator; the reducer
      // "reduces-to" sizes are left for the engineer (not captured on the quote).
      ductSegments.push({
        ...EMPTY_DUCT_SEGMENT,
        type: str(s.type) || "Straight Duct",
        horizontal: str(s.ductCalcWidth),
        vertical: str(s.ductCalcHeight),
        length: str(s.ductCalcLength),
        toHorizontal: "",
        toVertical: "",
        material: ductMaterial(s),
        gauge: str(s.ductGauge) || "GA20",
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
        project: fanProjectCode(s, it.descriptionSnapshot),
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
      motorLines.push({
        quantity: qty,
        uom: "pc",
        starterType: str(s.starterType),
        hp: str(s.motorHp),
        phase: str(s.motorPh) || "3",
        voltage: str(s.motorVolts),
      });
    } else if (isAccessory(s)) {
      accessoryLines.push({
        type: str(s.type),
        quantity: qty,
        uom: "pc",
        // Dimensions live in the description; the engineer fills the labelled
        // fields. Carry the description into the per-line note for context.
        dimensions: [],
        material: str(s.material),
        note: str(it.descriptionSnapshot),
      });
    }
  }

  const header = { date: opts.date, project: opts.project, dueDate: "", note: "", assignedPersonnel: "" };
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
