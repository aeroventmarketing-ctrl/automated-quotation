/**
 * Motor Controller prices — motor starters (DOL, Y-Δ, Y-YY) and VFDs.
 *
 * The owner, on Admin → Catalogue: *"add an option … so I can update the motor
 * controller price"* — the price a Motor Controller line fills in on a quotation
 * (e.g. DOL · 3-phase · 220 V · 1.5 HP → ₱10,405 net, ₱11,653.60 with VAT).
 *
 * These tables lived inside the quotation builder, so changing one needed a
 * developer and a deploy. They now follow the motors (`lib/motor-catalogue`):
 * each price is a catalogue row the owner edits in Admin → Catalogue, read back
 * through the same motor price map, and **these tables stay as the fallback** —
 * a missing or zeroed row prices exactly as before.
 *
 * Codes start `MTR-CTRL-`, inside the motors' `MTR-` prefix on purpose: every
 * place that keeps the motor price table out of the shop, the website price list
 * and the price map already keys on `MTR-`, so the controllers are handled the
 * same way without touching any of them. Prices are **net (before VAT)**, as the
 * tables always were; the quotation adds VAT.
 */
import { hpKey, type MotorPriceMap } from "@/lib/motor-catalogue";

export const CONTROLLER_CODE_PREFIX = "MTR-CTRL-";

/** DOL motor-starter HP buckets and net price by phase/voltage column. */
export const DOL_HP_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5];
export type DolColumn = "sp220" | "tp220" | "tp380400" | "tp440";
export const DOL_PRICE: Record<DolColumn, Record<number, number>> = {
  sp220: { 0.25: 9784, 0.5: 9784, 0.75: 9784, 1: 9784, 1.5: 9784, 2: 10826, 3: 11000, 5: 13045, 7.5: 16884 },
  tp220: { 0.25: 10405, 0.5: 10405, 0.75: 10405, 1: 10405, 1.5: 10405, 2: 10405, 3: 10405, 5: 11514, 7.5: 12692 },
  tp380400: { 0.25: 10386, 0.5: 10386, 0.75: 10386, 1: 10386, 1.5: 10386, 2: 10386, 3: 10386, 5: 10386, 7.5: 11507 },
  tp440: { 0.25: 10386, 0.5: 10386, 0.75: 10386, 1: 10386, 1.5: 10386, 2: 10386, 3: 10386, 5: 10386, 7.5: 10386 },
};
/** Reduced-voltage starters (Y-Δ / Y-YY) are sized for larger motors (5–50 HP). */
export const REDUCED_HP_OPTIONS = [5, 7.5, 10, 15, 20, 25, 30, 40, 50];
export const YDELTA_PRICE: Record<"220" | "440", Record<number, number>> = {
  "220": { 5: 19928, 7.5: 22930, 10: 25686, 15: 27725, 20: 32020, 25: 37213, 30: 39462, 40: 50266, 50: 64021 },
  "440": { 5: 22532, 7.5: 22532, 10: 23235, 15: 24945, 20: 25502, 25: 28249, 30: 29925, 40: 37443, 50: 39605 },
};
export const YYY_PRICE: Record<number, number> = { 5: 25624, 7.5: 25624, 10: 25926, 15: 28195, 20: 30378, 25: 32575, 30: 36307, 40: 42261, 50: 48414 };
/** Variable Frequency Drive: price by HP only; voltage just gates availability. */
export const VFD_HP_OPTIONS = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150];
export const VFD_PRICE: Record<number, number> = {
  1: 25042, 2: 25706, 3: 29696, 5: 32577, 7.5: 44100, 10: 49862, 15: 65485, 20: 77229, 25: 96620,
  30: 149804, 40: 167422, 50: 349137, 60: 394454, 75: 452071, 100: 573178, 125: 396893, 150: 461379,
};

/** Voltages valid for a starter type: Y-Δ → 220/440, Y-YY → 380/400, else all. */
export function starterVolts(drive: string | null | undefined): number[] {
  if (drive === "Y/Δ") return [220, 440];
  if (drive === "Y/YY") return [380, 400];
  return [220, 380, 400, 440];
}
/** HP buckets for a starter type (DOL: 0.25–7.5; Y-Δ / Y-YY: 5–50). */
export function starterHpOptions(drive: string | null | undefined): number[] {
  return drive === "Y/Δ" || drive === "Y/YY" ? REDUCED_HP_OPTIONS : DOL_HP_OPTIONS;
}
/** VFD voltages (3-phase): 220/380/400/440 up to 100 HP; 440 V only for 125 & 150 HP. */
export function vfdVolts(hp: number | null): number[] {
  return hp === 125 || hp === 150 ? [440] : [220, 380, 400, 440];
}

// --- Catalogue codes -------------------------------------------------------------

const DOL_COL_CODE: Record<DolColumn, string> = { sp220: "1PH-220V", tp220: "3PH-220V", tp380400: "3PH-380-400V", tp440: "3PH-440V" };
const DOL_COL_LABEL: Record<DolColumn, string> = { sp220: "1-Phase 220 V", tp220: "3-Phase 220 V", tp380400: "3-Phase 380/400 V", tp440: "3-Phase 440 V" };

export const dolCode = (col: DolColumn, hp: number) => `${CONTROLLER_CODE_PREFIX}DOL-${DOL_COL_CODE[col]}-${hpKey(hp)}HP`;
export const yDeltaCode = (volts: "220" | "440", hp: number) => `${CONTROLLER_CODE_PREFIX}YD-3PH-${volts}V-${hpKey(hp)}HP`;
export const yyyCode = (hp: number) => `${CONTROLLER_CODE_PREFIX}YYY-3PH-380-400V-${hpKey(hp)}HP`;
export const vfdCode = (hp: number) => `${CONTROLLER_CODE_PREFIX}VFD-3PH-${hpKey(hp)}HP`;

/** The DOL column for a phase + voltage (single-phase is 220 V only). */
export function dolColumn(phase: number | null, volts: number | null): DolColumn | null {
  if (phase === 1) return "sp220";
  if (volts === 220) return "tp220";
  if (volts === 440) return "tp440";
  if (volts === 380 || volts === 400) return "tp380400";
  return null;
}

export interface ControllerCatalogueRow {
  modelCode: string;
  name: string;
  /** Net PHP price, exactly as the table has it. */
  basePrice: number;
  specs: Record<string, unknown>;
}

const hpLabel = (hp: number) => String(hp);

/** Every motor-controller price, as a catalogue row, sorted by code. */
export function controllerCatalogueRows(): ControllerCatalogueRow[] {
  const rows: ControllerCatalogueRow[] = [];
  for (const col of Object.keys(DOL_PRICE) as DolColumn[]) {
    for (const hp of DOL_HP_OPTIONS) {
      const price = DOL_PRICE[col][hp];
      if (price == null) continue;
      rows.push({ modelCode: dolCode(col, hp), name: `Motor Controller · DOL Starter · ${DOL_COL_LABEL[col]} · ${hpLabel(hp)} HP`, basePrice: price, specs: { controller: "DOL", column: col, hp } });
    }
  }
  for (const v of ["220", "440"] as const) {
    for (const hp of REDUCED_HP_OPTIONS) {
      const price = YDELTA_PRICE[v][hp];
      if (price == null) continue;
      rows.push({ modelCode: yDeltaCode(v, hp), name: `Motor Controller · Y-Delta Starter · 3-Phase ${v} V · ${hpLabel(hp)} HP`, basePrice: price, specs: { controller: "Y/Δ", volts: Number(v), hp } });
    }
  }
  for (const hp of REDUCED_HP_OPTIONS) {
    const price = YYY_PRICE[hp];
    if (price == null) continue;
    rows.push({ modelCode: yyyCode(hp), name: `Motor Controller · Y-Double Y Starter · 3-Phase 380/400 V · ${hpLabel(hp)} HP`, basePrice: price, specs: { controller: "Y/YY", hp } });
  }
  for (const hp of VFD_HP_OPTIONS) {
    const price = VFD_PRICE[hp];
    if (price == null) continue;
    rows.push({ modelCode: vfdCode(hp), name: `Motor Controller · Variable Frequency Drive · 3-Phase · ${hpLabel(hp)} HP`, basePrice: price, specs: { controller: "VFD", hp } });
  }
  return rows.sort((a, b) => a.modelCode.localeCompare(b.modelCode));
}

// --- Prices: the catalogue first, the table as the fallback ------------------------

const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const fromCatalogue = (code: string, prices: MotorPriceMap | null | undefined): number | null => {
  const v = prices?.[code];
  return usable(v) ? v : null;
};

/** DOL price from phase + voltage + HP (single-phase is 220 V only). */
export function dolUnitPrice(phase: number | null, volts: number | null, hp: number | null, prices?: MotorPriceMap | null): number | null {
  if (phase == null || hp == null) return null;
  const col = dolColumn(phase, volts);
  if (!col) return null;
  const table = DOL_PRICE[col][hp];
  if (table == null) return null; // not a size that is sold
  return fromCatalogue(dolCode(col, hp), prices) ?? table;
}

/** Net (VAT-exclusive) price for a motor-starter selection, or null if incomplete. */
export function starterNetPrice(
  drive: string | null | undefined,
  phase: number | null,
  volts: number | null,
  hp: number | null,
  prices?: MotorPriceMap | null,
): number | null {
  if (hp == null) return null;
  if (drive === "DOL") return dolUnitPrice(phase, volts, hp, prices);
  if (drive === "Y/Δ") {
    const v = volts === 220 ? "220" : volts === 440 ? "440" : null;
    if (!v) return null;
    const table = YDELTA_PRICE[v][hp];
    return table == null ? null : fromCatalogue(yDeltaCode(v, hp), prices) ?? table;
  }
  if (drive === "Y/YY") {
    if (volts !== 380 && volts !== 400) return null;
    const table = YYY_PRICE[hp];
    return table == null ? null : fromCatalogue(yyyCode(hp), prices) ?? table;
  }
  return null;
}

/** VFD net (VAT-exclusive) price — needs HP and an available voltage. */
export function vfdNetPrice(volts: number | null, hp: number | null, prices?: MotorPriceMap | null): number | null {
  if (hp == null || volts == null || !vfdVolts(hp).includes(volts)) return null;
  const table = VFD_PRICE[hp];
  return table == null ? null : fromCatalogue(vfdCode(hp), prices) ?? table;
}
