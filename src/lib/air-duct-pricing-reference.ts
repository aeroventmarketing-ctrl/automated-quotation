/**
 * Air Duct sheet-metal pricing — REFERENCE DATA ONLY (not yet wired into the
 * quotation builder). Supplied by the client for future Air Duct auto-pricing.
 *
 * Sheet size: 1 sheet = 4 ft × 8 ft = 48 in × 96 in (≈ 1219 × 2438 mm).
 * Prices are per sheet (currency PHP). Labor is per sheet by material.
 *
 * OPEN QUESTIONS to resolve before wiring pricing:
 *  1. How to convert the entered duct L × W (mm) into a number of sheets
 *     (fractional area vs round-up; is L×W the flat blank or cross-section +
 *     a separate length?).
 *  2. Labor basis (per whole sheet vs proportional to the fraction used).
 *  3. Black Iron shows a single price column (no APO/Nihonbond split) — is it
 *     brand-independent, or is that one brand's price?
 *  4. Gauge reconciliation: the "Recommend" size→gauge schedule produces
 *     26/24/22/20/18 ga, but these price tables use 24/22/20/18/16 ga.
 *  5. Black Iron 16 ga price is still blank in the source.
 */

/** Actual sheet thickness (mm) by gauge, per the client's tables. */
export const AIR_DUCT_GAUGE_THICKNESS_MM: Record<string, number> = {
  "24": 0.6,
  "22": 0.7,
  "20": 0.9,
  "18": 1.1,
  "16": 1.3,
};

/** Galvanized Iron sheet price (PHP per sheet) by gauge and sealant brand. */
export const GI_SHEET_PRICE: Record<string, { Nihonbond: number; APO: number }> = {
  "24": { Nihonbond: 900, APO: 948 },
  "22": { Nihonbond: 1150, APO: 1280 },
  "20": { Nihonbond: 1415, APO: 1422 },
  "18": { Nihonbond: 1935, APO: 1944 },
  "16": { Nihonbond: 2447, APO: 2469 },
};

/**
 * Black Iron sheet price (PHP per sheet) by gauge — a single column in the
 * source (no APO/Nihonbond split; 16 ga not listed). Brand handling TBD.
 */
export const BLACK_IRON_SHEET_PRICE: Record<string, number> = {
  "24": 785,
  "22": 1000,
  "20": 1075,
  "18": 1472,
  // "16": not provided
};

/** Stainless Steel sheet price (PHP per sheet) by gauge (single column). */
export const STAINLESS_SHEET_PRICE: Record<string, number> = {
  "24": 2470,
  "22": 3170,
  "20": 4410,
  "18": 5410,
  "16": 6924,
};

/** Labor cost (PHP per sheet) by Air Duct material. */
export const AIR_DUCT_LABOR_PER_SHEET: Record<string, number> = {
  "Galvanized Iron": 450,
  "Black Iron": 900,
  "Stainless Steel": 1350,
};

/** Standard sheet dimensions. */
export const AIR_DUCT_SHEET = {
  widthIn: 48,
  lengthIn: 96,
  widthMm: 1219.2, // 48 in × 25.4
  lengthMm: 2438.4, // 96 in × 25.4
};
