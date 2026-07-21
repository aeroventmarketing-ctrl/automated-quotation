/**
 * Accessories Job Order.
 *
 * The Accessories department issues a job order made up of accessory product
 * lines — grilles, diffusers, louvers, dampers, clips, etc. Each line names the
 * product type, quantity, one or more labelled dimensions (e.g. "450 mm -
 * Horizontal Blade x 200 mm - Neck size") and the material. Parallel to the Duct
 * job order but with free-form, per-line dimensions since accessories vary widely.
 *
 * Stored as JSON on the order's workflow (no migration). An order can carry
 * several Accessories JOs (suffixed a, b, c … on a base number in its own
 * running ACCE-JO series).
 */
import { PRODUCT_TAXONOMY } from "@/lib/product-taxonomy";

/** Suggested accessory product types (every Ventilation Accessory except the
 * Air Duct group, which has its own Duct job order). Used as datalist hints —
 * the type field stays free text so anything (e.g. "Linear Bar Grille") works. */
export const ACCESSORY_TYPE_SUGGESTIONS: string[] = Array.from(
  new Set(
    PRODUCT_TAXONOMY.filter((e) => e.category === "Ventilation Accessories" && e.group !== "Air Duct").map((e) => e.type),
  ),
);

export const ACCESSORY_MATERIALS = [
  "Galvanized Iron",
  "Aluminum",
  "Stainless Steel 304",
];

/** How a material prints on the job order — abbreviated + the " Material" suffix. */
const MATERIAL_ABBREV: Record<string, string> = { "Galvanized Iron": "G.I." };
export function formatMaterialText(material: string): string {
  const m = material.trim();
  if (!m) return "";
  const label = MATERIAL_ABBREV[m] ?? m;
  return /material$/i.test(label) ? label : `${label} Material`;
}
export const ACCESSORY_UOMS = ["pc", "pcs", "set", "length", "lot"];

/** One labelled dimension of an accessory, e.g. value "450 mm", label "Horizontal Blade". */
export interface AccessoryDimension {
  value: string; // e.g. "450 mm"
  label: string; // e.g. "Horizontal Blade"
}

/** One accessory product line on the job order. */
export interface AccessoryLine {
  type: string; // e.g. "Linear Bar Grille"
  quantity: string; // e.g. "1"
  uom: string; // e.g. "pc"
  dimensions: AccessoryDimension[];
  material: string; // e.g. "Stainless Steel 304"
  note: string; // per-product remarks
}

export interface AccessoriesJobOrder {
  joNumber: string; // ACCE-JO2600044(a) — auto-generated
  date: string; // ISO date the JO was made
  project: string;
  dueDate: string; // ISO — the "Due" date
  lines: AccessoryLine[];
  // Remarks for this JO, surfaced on the order for conversation & remarks and
  // printed on the job order.
  note: string;
  // App-only — not printed on the job order.
  assignedPersonnel: string;
}

export const EMPTY_ACCESSORY_DIMENSION: AccessoryDimension = { value: "", label: "" };

export const EMPTY_ACCESSORY_LINE: AccessoryLine = {
  type: "",
  quantity: "1",
  uom: "pc",
  // Rectangular / square accessories always carry two dimensions.
  dimensions: [{ value: "", label: "" }, { value: "", label: "" }],
  material: "",
  note: "",
};

export const EMPTY_ACCESSORIES_JO: AccessoriesJobOrder = {
  joNumber: "",
  date: "",
  project: "",
  dueDate: "",
  lines: [],
  note: "",
  assignedPersonnel: "",
};

/**
 * The Accessories JO number for the JO at `index` of an order that carries
 * `total` Accessories JOs. Format: ACCE-JO<YY><5-digit base seq>; the a/b/c
 * suffix appears ONLY when the order has more than one. Example: base 44, year
 * 2026 → "ACCE-JO2600044".
 */
export function formatAccessoriesJoNumber(baseSeq: number, year: number, index: number, total: number): string {
  const yy = String(year % 100).padStart(2, "0");
  const seq = String(baseSeq).padStart(5, "0");
  const suffix = total > 1 ? String.fromCharCode(97 + index) : "";
  return `ACCE-JO${yy}${seq}${suffix}`;
}

/** The dimensions text for a line, e.g. "450 mm - Horizontal Blade x 200 mm - Neck size". */
export function formatAccessoryDimensions(line: AccessoryLine): string {
  return line.dimensions
    .map((d) => [d.value.trim(), d.label.trim()].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join(" x ");
}

/** The full descriptive line for an accessory (qty + dims / type / material). */
export function formatAccessoryLine(line: AccessoryLine): string {
  const qtyUom = [line.quantity.trim(), line.uom.trim()].filter(Boolean).join(" ");
  const dims = formatAccessoryDimensions(line);
  const head = [qtyUom, dims].filter(Boolean).join(" - ");
  return [head, line.type.trim(), formatMaterialText(line.material)].filter(Boolean).join(" / ");
}

/** Defensively coerce raw JSON into an AccessoryDimension. */
export function coerceAccessoryDimension(value: unknown): AccessoryDimension | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  return { value: o.value == null ? "" : String(o.value), label: o.label == null ? "" : String(o.label) };
}

/** Defensively coerce raw JSON into an AccessoryLine. */
export function coerceAccessoryLine(value: unknown): AccessoryLine | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: string) => (o[k] == null ? "" : String(o[k]));
  const dimensions = Array.isArray(o.dimensions)
    ? (o.dimensions as unknown[]).map(coerceAccessoryDimension).filter((d): d is AccessoryDimension => !!d)
    : [];
  // Rectangular / square accessories always have exactly two dimensions —
  // normalize (pad with blanks) so the form and print stay consistent.
  const twoDims: AccessoryDimension[] = [
    dimensions[0] ?? { value: "", label: "" },
    dimensions[1] ?? { value: "", label: "" },
  ];
  return {
    type: s("type"),
    quantity: s("quantity"),
    uom: s("uom") || "pc",
    dimensions: twoDims,
    material: s("material"),
    note: s("note"),
  };
}

/** Combined remarks for a JO — each product line's note (falls back to the
 * legacy job-order-level note). Used for the order conversation log & print. */
export function accessoriesJobRemarks(jo: AccessoriesJobOrder): string {
  const lineNotes = jo.lines
    .map((l, i) => (l.note.trim() ? `${i + 1}. ${l.note.trim()}` : ""))
    .filter(Boolean);
  return lineNotes.length ? lineNotes.join("\n") : jo.note.trim();
}

/** Defensively coerce raw JSON into an AccessoriesJobOrder. */
export function coerceAccessoriesJobOrder(value: unknown): AccessoriesJobOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const s = (k: keyof AccessoriesJobOrder) => (o[k] == null ? "" : String(o[k]));
  const lines = Array.isArray(o.lines)
    ? (o.lines as unknown[]).map(coerceAccessoryLine).filter((l): l is AccessoryLine => !!l)
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
