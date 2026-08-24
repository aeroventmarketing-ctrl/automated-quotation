/**
 * Multi-location stock routing for issuing/releasing from inventory.
 *
 * Which location a requesting department pulls stock from:
 *  - Fans & Blower, Duct, Accessories  → the **Plant Warehouse** only.
 *  - Motor Controller, Office          → a **choice** of Office (default) or
 *    Plant Warehouse.
 *
 * Pure helpers, safe to import on client and server. The location strings match
 * the inventory locations exactly (compared case-insensitively).
 */
export const PLANT_LOCATION = "Plant Warehouse";
export const OFFICE_LOCATION = "Office";

export type StockLocationMode = "plant" | "choose";
export interface StockLocationPolicy {
  mode: StockLocationMode;
  /** The location used by default (and the only one for plant-only depts). */
  default: string;
  /** The locations a user may pick from (one for plant-only, two for choose). */
  choices: string[];
}

// The departments that may pick Office as well as the Plant Warehouse.
const CHOOSE_DEPTS = new Set(["motor", "office"]);

/** The stock-location policy for a requesting department key. */
export function stockLocationPolicy(dept: string | null | undefined): StockLocationPolicy {
  if (dept && CHOOSE_DEPTS.has(dept)) {
    return { mode: "choose", default: OFFICE_LOCATION, choices: [OFFICE_LOCATION, PLANT_LOCATION] };
  }
  return { mode: "plant", default: PLANT_LOCATION, choices: [PLANT_LOCATION] };
}

/** Case-insensitive location comparison (trims whitespace). */
export const locEquals = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** From a set of same-item rows, the one at `location` (case-insensitive). */
export function rowAtLocation<T extends { location?: string | null }>(rows: T[], location: string): T | undefined {
  return rows.find((r) => locEquals(r.location, location));
}

/**
 * The location a department should issue from for a given (optional) user choice.
 * Plant-only depts always resolve to the Plant Warehouse; choose depts honour a
 * valid choice, else fall back to their default (Office).
 */
export function resolveIssueLocation(dept: string | null | undefined, chosen?: string | null): string {
  const policy = stockLocationPolicy(dept);
  if (policy.mode === "plant") return PLANT_LOCATION;
  if (chosen && policy.choices.some((c) => locEquals(c, chosen))) {
    return policy.choices.find((c) => locEquals(c, chosen))!;
  }
  return policy.default;
}

/**
 * Server guard (defense-in-depth): may `dept` issue from a row at `location`?
 * Plant-only depts must never pull Office stock (any other location — Plant, an
 * unset/other location — is fine); choose depts may pull from anywhere. The
 * client already resolves the right row via `pickIssueRow`; this just refuses a
 * plant-only department that somehow points at Office stock.
 */
export function isLocationAllowedForDept(location: string | null | undefined, dept: string | null | undefined): boolean {
  if (stockLocationPolicy(dept).mode === "choose") return true;
  return !locEquals(location, OFFICE_LOCATION);
}

/**
 * Choose which of an item's location rows to issue from, given the requesting
 * department and an optional user choice. Shared by the client (to show the
 * right availability and issue that row) and the server (to deduct from it), so
 * both always agree.
 *
 * Rules:
 *  - **Plant-only depts (fans / duct / accessories):** the Plant Warehouse row;
 *    if the item has none, any NON-Office row (a plain single-location item with
 *    no/other location still issues); Office stock is never pulled. Returns
 *    `undefined` when the only stock is in Office → the caller sends it to
 *    purchasing.
 *  - **Choose depts (motor / office):** the row at the chosen location (default
 *    Office); else the other permitted location; else any row.
 *
 * A single-location item returns that one row for every department, so ordinary
 * stock is unaffected.
 */
export function pickIssueRow<T extends { location?: string | null }>(
  rows: T[],
  dept: string | null | undefined,
  chosen?: string | null,
): T | undefined {
  if (rows.length === 0) return undefined;
  const policy = stockLocationPolicy(dept);
  if (policy.mode === "plant") {
    // Plant Warehouse first, then any non-Office row; Office stock is never
    // pulled (returns undefined → the caller sends the line to purchasing).
    return rowAtLocation(rows, PLANT_LOCATION) ?? rows.find((r) => !locEquals(r.location, OFFICE_LOCATION));
  }
  // Choose dept: the chosen/default location, then the other permitted location,
  // then any row.
  const target = resolveIssueLocation(dept, chosen);
  const exact = rowAtLocation(rows, target);
  if (exact) return exact;
  for (const c of policy.choices) {
    const row = rowAtLocation(rows, c);
    if (row) return row;
  }
  return rows[0];
}
