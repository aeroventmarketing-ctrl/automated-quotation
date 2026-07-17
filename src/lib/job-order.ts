/**
 * Fans & Blowers (Centrifugal Blower) Job Order.
 *
 * The engineer fills these fields; they map 1:1 to the "Red - Editable" input
 * cells (column B) of the Source sheet in the Centrifugal Blower JO template.
 * Everything else on the printable "Centrifugal Blower" sheet — shafting,
 * bearing, hub, motor specs, pulleys, computed RPM — is derived by the
 * template's own VLOOKUP formulas, which Excel recomputes on open.
 *
 * Stored as JSON on the order's workflow (no migration). An order can carry
 * several Fans & Blowers JOs (suffixed a, b, c … on the base number).
 */

/**
 * The Fans & Blowers department issues six kinds of job order, each with its own
 * Excel template and (eventually) its own field set. They all share one running
 * AFBM-JO number series. A type is "ready" once its template is registered here;
 * until then it shows in the picker but can't be created. Wire a new type by
 * dropping its template into public/templates and filling in `template`.
 */
export interface JoTypeDef {
  key: string;
  label: string;
  /** Template filename under public/templates, or null until it's uploaded. */
  template: string | null;
}

export const JO_TYPES: JoTypeDef[] = [
  { key: "centrifugal_blower", label: "Centrifugal Blower", template: "fans-jo-template.xlsx" },
  { key: "centrifugal_inline_blower", label: "Centrifugal Inline Blower", template: "fans-inline-jo-template.xlsx" },
  { key: "panel_fan", label: "Panel Fan", template: "fans-panel-jo-template.xlsx" },
  { key: "power_roof", label: "Power Roof", template: "fans-powerroof-jo-template.xlsx" },
  { key: "tubeaxial_vaneaxial", label: "Tubeaxial / Vaneaxial", template: "fans-axial-jo-template.xlsx" },
  { key: "centrifugal_blower_didw", label: "Centrifugal Blower DIDW", template: "fans-didw-jo-template.xlsx" },
];

export const DEFAULT_JO_TYPE = "centrifugal_blower";

export function joTypeDef(key: string): JoTypeDef | undefined {
  return JO_TYPES.find((t) => t.key === key);
}
export function joTypeLabel(key: string): string {
  return joTypeDef(key)?.label ?? key;
}
/** A type is ready to be created once its template has been registered. */
export function joTypeReady(key: string): boolean {
  return !!joTypeDef(key)?.template;
}

export interface FansJobOrder {
  // Which of the six Fans & Blowers JO types this is (drives template + form).
  type: string;
  // Header details
  joNumber: string; // AFBM-JO2600054(a) — auto-generated
  date: string; // ISO date the JO was made
  project: string; // e.g. "CEB"
  make: string; // e.g. "Standard"
  targetDate: string; // ISO target completion date
  quantity: string;
  uom: string; // e.g. "pcs."
  bodyLeadTime: string; // days
  bladeLeadTime: string; // days
  // Fan / blower details
  bladeDiameter: string; // inches, keys the blade lookup table
  orientation: string; // discharge/orientation, e.g. "Top Horizontal"
  rotation: string; // "Clockwise" / "Counterclockwise" / both
  bladeType: string; // impeller blade type, e.g. "Backwardly Inclined"
  driveType: string; // "Belt" / "Direct"
  capacity: string; // e.g. '21,338 cfm @ 2" w.g.'
  capacityAt0: string; // test at 0" w.g., e.g. '29,087 cfm @ 0" w.g.'
  rpmCatalogue: string; // catalogue RPM
  // Motor details
  motorBrand: string; // e.g. "Hyundai" / "TECO"
  motorPhAlias: string; // phase alias that keys the motor table, e.g. "Hyundai_3Phase"
  motorHp: string; // the motor selection string, e.g. "15 HP, 3PH, Hyundai"
  voltage: string;
  frequency: string;
  mounting: string; // e.g. "Foot Mounted"
  enclosure: string; // e.g. "TEFC"
  motorPulley: string; // inches
  fanPulley: string; // inches
  // App-only (NOT written to the JO Excel — the template has no cell for it).
  assignedPersonnel: string;
  // When true, this is a direct-drive blower JO (uses the direct-drive template).
  directDrive: boolean;
}

export const EMPTY_FANS_JO: FansJobOrder = {
  type: DEFAULT_JO_TYPE,
  joNumber: "",
  date: "",
  project: "",
  make: "Standard",
  targetDate: "",
  quantity: "",
  uom: "pcs.",
  bodyLeadTime: "",
  bladeLeadTime: "",
  bladeDiameter: "",
  orientation: "",
  rotation: "",
  bladeType: "",
  driveType: "",
  capacity: "",
  capacityAt0: "",
  rpmCatalogue: "",
  motorBrand: "",
  motorPhAlias: "",
  motorHp: "",
  voltage: "",
  frequency: "",
  mounting: "",
  enclosure: "",
  motorPulley: "",
  fanPulley: "",
  assignedPersonnel: "",
  directDrive: false,
};

/**
 * The JO number for the JO at `index` of an order that carries `total` JOs.
 * Format: AFBM-JO<YY><5-digit base seq>. The a/b/c suffix appears ONLY when the
 * order has more than one JO. Example: base 54, year 2026 → "AFBM-JO2600054";
 * with 3 JOs → "AFBM-JO2600054a", "…b", "…c".
 */
export function formatJoNumber(baseSeq: number, year: number, index: number, total: number): string {
  const yy = String(year % 100).padStart(2, "0");
  const seq = String(baseSeq).padStart(5, "0");
  const suffix = total > 1 ? String.fromCharCode(97 + index) : "";
  return `AFBM-JO${yy}${seq}${suffix}`;
}

/** Defensively coerce raw JSON into a FansJobOrder. */
export function coerceFansJobOrder(value: unknown): FansJobOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: keyof FansJobOrder) => (o[k] == null ? "" : String(o[k]));
  return {
    type: s("type") || DEFAULT_JO_TYPE,
    joNumber: s("joNumber"),
    date: s("date"),
    project: s("project"),
    make: s("make") || "Standard",
    targetDate: s("targetDate"),
    quantity: s("quantity"),
    uom: s("uom") || "pcs.",
    bodyLeadTime: s("bodyLeadTime"),
    bladeLeadTime: s("bladeLeadTime"),
    bladeDiameter: s("bladeDiameter"),
    orientation: s("orientation"),
    rotation: s("rotation"),
    bladeType: s("bladeType"),
    driveType: s("driveType"),
    capacity: s("capacity"),
    capacityAt0: s("capacityAt0"),
    rpmCatalogue: s("rpmCatalogue"),
    motorBrand: s("motorBrand"),
    motorPhAlias: s("motorPhAlias"),
    motorHp: s("motorHp"),
    voltage: s("voltage"),
    frequency: s("frequency"),
    mounting: s("mounting"),
    enclosure: s("enclosure"),
    motorPulley: s("motorPulley"),
    fanPulley: s("fanPulley"),
    assignedPersonnel: s("assignedPersonnel"),
    directDrive: Boolean(o.directDrive),
  };
}
