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

export interface FansJobOrder {
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
}

export const EMPTY_FANS_JO: FansJobOrder = {
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
};

/** Defensively coerce raw JSON into a FansJobOrder. */
export function coerceFansJobOrder(value: unknown): FansJobOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: keyof FansJobOrder) => (o[k] == null ? "" : String(o[k]));
  return {
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
  };
}
