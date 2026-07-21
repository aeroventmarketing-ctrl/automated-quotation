/**
 * Duct Job Order.
 *
 * The Duct department issues a job order made up of duct segment lines — a mix
 * of straight ducts and reducers — each with its material and gauge. Parallel to
 * the Fans & Blowers job order but far simpler: there is no lookup-driven Excel
 * template, so the printable sheet is built from these fields directly.
 *
 * Stored as JSON on the order's workflow (no migration). An order can carry
 * several Duct JOs (suffixed a, b, c … on a base number in its own running
 * DUCT-JO series).
 */

/**
 * The duct product types a segment can be — the "Air Duct" group of the product
 * taxonomy. Size-transition types (a reducer / square-to-round) additionally
 * capture the "to" dimensions they step down to over the segment length.
 */
export const DUCT_TYPES = [
  "Straight Duct",
  "Duct Reducer",
  "Duct Connector",
  "Elbow Duct",
  "Offset Duct",
  "R-Duct",
  "Square to Round Duct",
  "Y-Duct",
] as const;
export type DuctType = (typeof DUCT_TYPES)[number];

/** Types that transition between two cross-sections — they show "to" dimensions. */
const REDUCING_DUCT_TYPES = new Set<string>(["Duct Reducer", "Square to Round Duct"]);
export function isReducingDuctType(type: string): boolean {
  return REDUCING_DUCT_TYPES.has(type);
}

/** One duct segment line. Every type carries H×V×Length; the size-transition
 * types add the "to" dimensions it steps down to over that length. */
export interface DuctSegment {
  type: string; // one of DUCT_TYPES
  horizontal: string; // mm — the first (Horizontal) dimension
  vertical: string; // mm — the Vertical dimension
  length: string; // mm — segment length (for a reducer, the reducing length)
  toHorizontal: string; // size-transition types only — Horizontal it reduces to
  toVertical: string; // size-transition types only — Vertical it reduces to
  material: string; // e.g. "G.I. Material"
  gauge: string; // e.g. "GA20"
}

export interface DuctJobOrder {
  joNumber: string; // DUCT-JO2600026(a) — auto-generated
  date: string; // ISO date the JO was made
  project: string; // free text project code / name
  dueDate: string; // ISO — the "Due date" the duct is needed
  quantity: string;
  uom: string; // e.g. "set"
  segments: DuctSegment[];
  // Remarks for this duct JO (e.g. "Center Reducer / Flat bottom"). Surfaced on
  // the order for conversation & remarks and printed on the job order.
  note: string;
  // App-only — not printed on the job order.
  assignedPersonnel: string;
}

export const DUCT_MATERIALS = ["G.I. Material", "Stainless Steel", "Aluminum", "Black Iron", "PVC"];
export const DUCT_GAUGES = ["GA26", "GA24", "GA22", "GA20", "GA18", "GA16"];
export const DUCT_UOMS = ["set", "pc", "pcs", "length", "lot"];

export const EMPTY_DUCT_SEGMENT: DuctSegment = {
  type: "Straight Duct",
  horizontal: "",
  vertical: "",
  length: "",
  toHorizontal: "",
  toVertical: "",
  material: "G.I. Material",
  gauge: "GA20",
};

export const EMPTY_DUCT_JO: DuctJobOrder = {
  joNumber: "",
  date: "",
  project: "",
  dueDate: "",
  quantity: "",
  uom: "set",
  segments: [],
  note: "",
  assignedPersonnel: "",
};

/**
 * The Duct JO number for the JO at `index` of an order that carries `total` Duct
 * JOs. Format: DUCT-JO<YY><5-digit base seq>. The a/b/c suffix appears ONLY when
 * the order has more than one Duct JO. Example: base 26, year 2026 →
 * "DUCT-JO2600026".
 */
export function formatDuctJoNumber(baseSeq: number, year: number, index: number, total: number): string {
  const yy = String(year % 100).padStart(2, "0");
  const seq = String(baseSeq).padStart(5, "0");
  const suffix = total > 1 ? String.fromCharCode(97 + index) : "";
  return `DUCT-JO${yy}${seq}${suffix}`;
}

/** The "(Horizontal x Vertical x Length)" descriptive text for one segment. */
export function formatSegmentDimensions(seg: DuctSegment): string {
  const h = seg.horizontal.trim();
  const v = seg.vertical.trim();
  const l = seg.length.trim();
  if (isReducingDuctType(seg.type)) {
    const th = seg.toHorizontal.trim();
    const tv = seg.toVertical.trim();
    return `${h} x ${v} to ${th} x ${tv} mm - ${l} mm length`;
  }
  return `${h} x ${v} x ${l} mm`;
}

/** The duct type label used on the printable job order. */
export function segmentTypeLabel(seg: DuctSegment): string {
  return seg.type || "Straight Duct";
}

/** The full descriptive line for a segment (dimensions / type / material / gauge). */
export function formatSegmentLine(seg: DuctSegment): string {
  return [formatSegmentDimensions(seg), segmentTypeLabel(seg), seg.material.trim(), seg.gauge.trim()]
    .filter(Boolean)
    .join(" / ");
}

/** Defensively coerce raw JSON into a DuctSegment. */
export function coerceDuctSegment(value: unknown): DuctSegment | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: string) => (o[k] == null ? "" : String(o[k]));
  // Legacy segments stored `kind: "straight" | "reducer"` — map to the type.
  const type = o.type != null && String(o.type)
    ? String(o.type)
    : o.kind === "reducer"
    ? "Duct Reducer"
    : "Straight Duct";
  return {
    type,
    horizontal: s("horizontal"),
    vertical: s("vertical"),
    length: s("length"),
    toHorizontal: s("toHorizontal"),
    toVertical: s("toVertical"),
    material: s("material") || "G.I. Material",
    gauge: s("gauge") || "GA20",
  };
}

/** Defensively coerce raw JSON into a DuctJobOrder. */
export function coerceDuctJobOrder(value: unknown): DuctJobOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: keyof DuctJobOrder) => (o[k] == null ? "" : String(o[k]));
  const segments = Array.isArray(o.segments)
    ? (o.segments as unknown[]).map(coerceDuctSegment).filter((x): x is DuctSegment => !!x)
    : [];
  return {
    joNumber: s("joNumber"),
    date: s("date"),
    project: s("project"),
    dueDate: s("dueDate"),
    quantity: s("quantity"),
    uom: s("uom") || "set",
    segments,
    note: s("note"),
    assignedPersonnel: s("assignedPersonnel"),
  };
}
