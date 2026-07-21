/**
 * Motor Controller Job Order.
 *
 * The Motor Controller department issues a job order made up of motor-controller
 * lines — each a controller with a starter/control method and a motor rating
 * (HP, phase, voltage), e.g. "2 pcs - Motor controller / Direct on line / 5 Hp,
 * 3 Ph, 400v". Parallel to the Duct / Accessories job orders.
 *
 * Stored as JSON on the order's workflow (no migration). An order can carry
 * several Motor Controller JOs (suffixed a, b, c … on a base number in its own
 * running MC-JO series).
 */

/** The starter types a motor controller can use. */
export const STARTER_TYPES = ["DOL", "Y/Δ", "Y/YY"];
export const MC_PHASES = ["1", "3"];
export const MC_UOMS = ["pc", "pcs", "set", "lot"];

/** The fixed product label printed for every motor-controller line. */
export const MOTOR_CONTROLLER_LABEL = "Motor controller";

/** One motor-controller product line on the job order. */
export interface MotorControllerLine {
  quantity: string; // e.g. "2"
  uom: string; // e.g. "pcs"
  starterType: string; // e.g. "Direct on line"
  hp: string; // e.g. "5"
  phase: string; // e.g. "3"
  voltage: string; // e.g. "400"
}

export interface MotorControllerJobOrder {
  joNumber: string; // MC-JO2600047(a) — auto-generated
  date: string; // ISO date the JO was made
  project: string;
  dueDate: string; // ISO — the "Due" date
  lines: MotorControllerLine[];
  // Remarks for this JO, surfaced on the order for conversation & remarks and
  // printed on the job order.
  note: string;
  // App-only — not printed on the job order.
  assignedPersonnel: string;
}

export const EMPTY_MOTOR_CONTROLLER_LINE: MotorControllerLine = {
  quantity: "1",
  uom: "pc",
  starterType: "",
  hp: "",
  phase: "3",
  voltage: "",
};

export const EMPTY_MOTOR_CONTROLLER_JO: MotorControllerJobOrder = {
  joNumber: "",
  date: "",
  project: "",
  dueDate: "",
  lines: [],
  note: "",
  assignedPersonnel: "",
};

/**
 * The Motor Controller JO number for the JO at `index` of an order that carries
 * `total` MC JOs. Format: MC-JO<YY><5-digit base seq>; the a/b/c suffix appears
 * ONLY when the order has more than one. Example: base 47, year 2026 →
 * "MC-JO2600047".
 */
export function formatMotorControllerJoNumber(baseSeq: number, year: number, index: number, total: number): string {
  const yy = String(year % 100).padStart(2, "0");
  const seq = String(baseSeq).padStart(5, "0");
  const suffix = total > 1 ? String.fromCharCode(97 + index) : "";
  return `MC-JO${yy}${seq}${suffix}`;
}

/** The motor rating text for a line, e.g. "5 Hp, 3 Ph, 400v". */
export function formatMotorRating(line: MotorControllerLine): string {
  return [
    line.hp.trim() && `${line.hp.trim()} Hp`,
    line.phase.trim() && `${line.phase.trim()} Ph`,
    line.voltage.trim() && `${line.voltage.trim()}v`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** The full descriptive line, e.g. "2 pcs - Motor controller / Direct on line / 5 Hp, 3 Ph, 400v". */
export function formatMotorControllerLine(line: MotorControllerLine): string {
  const qtyUom = [line.quantity.trim(), line.uom.trim()].filter(Boolean).join(" ");
  const head = [qtyUom, MOTOR_CONTROLLER_LABEL].filter(Boolean).join(" - ");
  return [head, line.starterType.trim(), formatMotorRating(line)].filter(Boolean).join(" / ");
}

/** Defensively coerce raw JSON into a MotorControllerLine. */
export function coerceMotorControllerLine(value: unknown): MotorControllerLine | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: keyof MotorControllerLine) => (o[k] == null ? "" : String(o[k]));
  return {
    quantity: s("quantity"),
    uom: s("uom") || "pc",
    starterType: s("starterType"),
    hp: s("hp"),
    phase: s("phase"),
    voltage: s("voltage"),
  };
}

/** Defensively coerce raw JSON into a MotorControllerJobOrder. */
export function coerceMotorControllerJobOrder(value: unknown): MotorControllerJobOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: keyof MotorControllerJobOrder) => (o[k] == null ? "" : String(o[k]));
  const lines = Array.isArray(o.lines)
    ? (o.lines as unknown[]).map(coerceMotorControllerLine).filter((l): l is MotorControllerLine => !!l)
    : [];
  return {
    joNumber: s("joNumber"),
    date: s("date"),
    project: s("project"),
    dueDate: s("dueDate"),
    lines,
    note: s("note"),
    assignedPersonnel: s("assignedPersonnel"),
  };
}
