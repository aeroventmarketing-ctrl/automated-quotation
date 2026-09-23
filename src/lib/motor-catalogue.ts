/**
 * Induction-motor prices, as catalogue rows.
 *
 * ## Why this file exists
 *
 * Every motor price in the app used to live in a hand-edited TypeScript table:
 * `pricing/motors.ts` (the motor inside every fabricated fan), plus its
 * `EXPROOF_PRICE_BY_HP` override, and the two standalone selling databases
 * `teco-induction-selling.ts` and `hyundai-induction-selling.ts`. A supplier
 * price increase therefore needed a developer and a deploy — and price increases
 * do not happen once, they happen **per supplier**, over and over.
 *
 * So the prices move into `CatalogueItem` + `PriceListEntry`, where the owner
 * edits them in Admin → Catalogue and bulk-edits them through the Excel/CSV
 * round trip that is already there. This file is the bridge: it turns the code
 * tables into the rows to seed, and it stays as the FALLBACK, so nothing breaks
 * if a row is missing or deleted.
 *
 * ## One row per price, not one row per motor
 *
 * A flat list, deliberately. The alternative was one item per (HP, phase) with
 * the pole as a `PriceListEntry.variantKey`, which reads more nicely — but the
 * catalogue CSV importer only ever writes the `default` variant, so those prices
 * could not be bulk-edited, which is the entire point of moving them. A flat row
 * per purchasable configuration is also simply more honest: a 3 HP 4-pole and a
 * 3 HP 2-pole are different motors at different prices, and foot- and
 * flange-mounted are different things you buy.
 *
 * ## The model code cannot be the motor's model code
 *
 * `CatalogueItem.modelCode` is UNIQUE, and TECO's codes are not. Eight codes in
 * `pricing/motors.ts` are shared by two or three rows at different prices —
 * `1K3F2T` is 1 HP 3-phase at 2, 4 and 6 poles, at ₱10,001 / ₱10,001 / ₱15,572 —
 * because the pole is not encoded in the code (that file's own comment says so).
 * The same holds for TECO frame numbers: 32 distinct frames across 81 rows.
 *
 * So the catalogue code is a SYNTHETIC key that spells out the configuration,
 * and the real model codes ride along in `specs` where the quotation builder
 * already reads them. The code is what makes a row findable in a spreadsheet;
 * the name is what a human reads.
 *
 * ## The two TECO tables are NOT merged
 *
 * `pricing/motors.ts` and `teco-induction-selling.ts` describe the same TECO
 * motors, and **33 of 41 overlapping prices have drifted apart** — by ₱15,440 on
 * a 100 HP 4-pole, and ₱12,305 the other way on a 15 HP 6-pole. That is
 * deliberate: the selling file says in its own header that it is *"independent of
 * lib/pricing/motors.ts (which prices blower + motor combos and must not
 * change)"*. A newer TECO list arrived and fan pricing was left alone on purpose.
 *
 * Merging them here would silently re-price every fabricated fan. So both are
 * seeded, as separate rows, named so the difference is visible in the tab rather
 * than buried in two files. Whether fan motors should adopt the newer prices is
 * a commercial decision, and it belongs to the owner, not to this file.
 */
import { MOTORS, EXPROOF_PRICE_BY_HP, exproofApplies, type MotorRow } from "@/lib/pricing/motors";
import { TECO_SELLING, type TecoSection } from "@/lib/teco-induction-selling";
import { HYUNDAI_SELLING } from "@/lib/hyundai-induction-selling";

/**
 * Every motor's catalogue code starts with this.
 *
 * It is how the price map is SELECTED, rather than `family: "MOTOR"`. That is
 * not a style choice — it is the fix for an outage. `MOTOR` is a new value on
 * the `Family` enum, supplied by a migration, and this repo's deploy runs
 * `prisma generate && next build` with no `prisma migrate deploy`. So the code
 * shipped before the enum existed, and every query naming `"MOTOR"` threw
 * `invalid input value for enum "Family"` — taking the whole Admin → Catalogue
 * page down with a 500.
 *
 * A query keyed on the model code cannot fail that way, whatever order the
 * deploy happens in. `MOTOR` stays on the row as a LABEL — for the family chip,
 * for grouping, for the person reading the list — and nothing depends on it
 * being there to answer a question.
 */
export const MOTOR_CODE_PREFIX = "MTR-";

/** Which code table a row came from — also the prefix of its catalogue code. */
export type MotorSource = "fan" | "teco" | "hyundai";

/** How the motor is mounted. Priced separately on the standalone lines. */
export type MotorMounting = "foot" | "flange";

export interface MotorCatalogueRow {
  /** `CatalogueItem.modelCode` — synthetic, unique, and sorts sensibly. */
  modelCode: string;
  /** What a human reads in the Catalogue tab. */
  name: string;
  source: MotorSource;
  hp: number;
  phase: number;
  pole: number;
  /** Net PHP price, exactly as the code table has it today. */
  basePrice: number;
  /** Everything the pricing code needs that is not the price. */
  specs: Record<string, unknown>;
}

/**
 * HP in the code, zero-padded so a spreadsheet sorts 5 HP before 10 HP.
 *
 * Without this the tab reads 1, 10, 100, 15, 2, 20… which is exactly the list
 * somebody scrolls past the row they wanted. Three integer digits covers the
 * 200 HP top of the range.
 *
 * TWO decimals, not one. The range today is 0.25 → 200 HP and one decimal has no
 * collisions in it, but it renders the 0.25 HP motor as `000.3` — a code that
 * names a motor that does not exist, and one that a 0.3 HP motor would later
 * collide with. A unique key that rounds is a key waiting to stop being unique.
 */
export function hpKey(hp: number): string {
  return hp.toFixed(2).padStart(6, "0");
}

/** `1` → "1", `7.5` → "7.5" — for a name, where padding would look broken. */
const hpLabel = (hp: number) => (Number.isInteger(hp) ? String(hp) : String(hp));

const poleLabel = (pole: number) => `${pole}-Pole`;
const phaseLabel = (phase: number) => (phase === 1 ? "1-Phase" : "3-Phase");

/* ------------------------------------------------------------------ *
 * The fan motor — `pricing/motors.ts`
 * ------------------------------------------------------------------ */

/**
 * The motor inside a fabricated fan: `line price = blower body + motor`.
 *
 * This is the table that matters most. It is priced into every belt-drive and
 * direct-drive fan the business quotes, and it is the one a TECO increase hits
 * hardest — which is why it is first.
 */
export function fanMotorCode(hp: number, phase: number, pole: number, exproof = false): string {
  return `MTR-FAN-${hpKey(hp)}HP-${phase}PH-${pole}P${exproof ? "-EX" : ""}`;
}

function fanMotorRows(): MotorCatalogueRow[] {
  const rows: MotorCatalogueRow[] = [];
  for (const m of MOTORS) {
    rows.push({
      modelCode: fanMotorCode(m.hp, m.phase, m.pole),
      name: `Fan Motor ${hpLabel(m.hp)} HP · ${phaseLabel(m.phase)} · ${poleLabel(m.pole)} (TECO)`,
      source: "fan",
      hp: m.hp,
      phase: m.phase,
      pole: m.pole,
      basePrice: m.price,
      specs: { m220: m.m220, m380: m.m380, m440: m.m440 },
    });

    /**
     * Explosion-proof is an OVERRIDE, not a surcharge — `motorNetPrice` replaces
     * the standard price with it rather than adding to it. So it is its own row,
     * priced outright, which is also the only way the owner can raise one
     * without the other.
     *
     * Published for 3-phase 4-pole only; `exproofApplies` is the same predicate
     * the pricing uses, so this list cannot drift from what the app will accept.
     */
    const ex = EXPROOF_PRICE_BY_HP[m.hp];
    if (ex != null && exproofApplies(m, true)) {
      rows.push({
        modelCode: fanMotorCode(m.hp, m.phase, m.pole, true),
        name: `Fan Motor ${hpLabel(m.hp)} HP · ${phaseLabel(m.phase)} · ${poleLabel(m.pole)} · Explosion-Proof (TECO)`,
        source: "fan",
        hp: m.hp,
        phase: m.phase,
        pole: m.pole,
        basePrice: ex,
        // The EX model code swaps the trailing "T" (TEFC) for "X".
        specs: {
          exproof: true,
          m220: exCode(m.m220),
          m380: exCode(m.m380),
          m440: exCode(m.m440),
        },
      });
    }
  }
  return rows;
}

const exCode = (code: string | null) => (code ? code.replace(/T$/, "X") : null);

/* ------------------------------------------------------------------ *
 * The standalone selling lines — TECO and Hyundai
 * ------------------------------------------------------------------ */

const TECO_SECTION_LABEL: Record<TecoSection, string> = {
  single: "1-Phase TEFC",
  ex: "3-Phase Explosion-Proof",
  three: "3-Phase TEFC",
};

/** TECO sells single-phase at 1 phase; the other two sections are 3-phase. */
const tecoPhase = (section: TecoSection) => (section === "single" ? 1 : 3);

export function tecoCode(section: TecoSection, hp: number, pole: number, mounting: MotorMounting): string {
  return `MTR-TECO-${section.toUpperCase()}-${hpKey(hp)}HP-${pole}P-${mounting.toUpperCase()}`;
}

export function hyundaiCode(hp: number, pole: number, mounting: MotorMounting): string {
  return `MTR-HYU-${hpKey(hp)}HP-${pole}P-${mounting.toUpperCase()}`;
}

const mountLabel = (m: MotorMounting) => (m === "foot" ? "Foot Mounted" : "Flange Mounted");

function tecoRows(): MotorCatalogueRow[] {
  const rows: MotorCatalogueRow[] = [];
  for (const [key, r] of Object.entries(TECO_SELLING)) {
    const section = key.split("|")[0] as TecoSection;
    const phase = tecoPhase(section);
    // `flange: null` means TECO does not offer it at that HP — not a free one.
    const prices: [MotorMounting, number | null][] = [["foot", r.foot], ["flange", r.flange]];
    for (const [mounting, price] of prices) {
      if (price == null) continue;
      rows.push({
        modelCode: tecoCode(section, r.hp, r.pole, mounting),
        name: `TECO Motor ${hpLabel(r.hp)} HP · ${TECO_SECTION_LABEL[section]} · ${poleLabel(r.pole)} · ${mountLabel(mounting)}`,
        source: "teco",
        hp: r.hp,
        phase,
        pole: r.pole,
        basePrice: price,
        specs: { section, mounting, frame: r.frame, kw: r.kw, rpm: r.rpm },
      });
    }
  }
  return rows;
}

function hyundaiRows(): MotorCatalogueRow[] {
  const rows: MotorCatalogueRow[] = [];
  for (const r of Object.values(HYUNDAI_SELLING)) {
    const prices: [MotorMounting, number | null][] = [["foot", r.foot], ["flange", r.flange]];
    for (const [mounting, price] of prices) {
      if (price == null) continue;
      rows.push({
        modelCode: hyundaiCode(r.hp, r.pole, mounting),
        // Hyundai's range is 3-phase TEFC only — no single-phase, no EX.
        name: `Hyundai Motor ${hpLabel(r.hp)} HP · 3-Phase TEFC · ${poleLabel(r.pole)} · ${mountLabel(mounting)}`,
        source: "hyundai",
        hp: r.hp,
        phase: 3,
        pole: r.pole,
        basePrice: price,
        specs: { mounting, frame: r.frame, kw: r.kw, rpm: r.rpm },
      });
    }
  }
  return rows;
}

/**
 * Every motor price in the app, as a catalogue row.
 *
 * Sorted by code so the seed, the tab and a downloaded spreadsheet all agree on
 * the order — a diff between two exports should be the prices that changed, not
 * the order they came out in.
 */
export function motorCatalogueRows(): MotorCatalogueRow[] {
  return [...fanMotorRows(), ...tecoRows(), ...hyundaiRows()].sort((a, b) =>
    a.modelCode.localeCompare(b.modelCode),
  );
}

/* ------------------------------------------------------------------ *
 * Reading the prices back
 * ------------------------------------------------------------------ */

/**
 * Catalogue prices, keyed by the codes above — what the pricing code looks in
 * before falling back to its own table.
 */
export type MotorPriceMap = Record<string, number>;

/**
 * The fan-motor price for a row, preferring the catalogue.
 *
 * Deliberately the same shape as `motorNetPrice` in `pricing/motors.ts`, and it
 * defers to it when the catalogue has nothing to say. Seeded from that table, so
 * on day one the two agree exactly — there is a test that walks every row and
 * asserts it, because "the refactor moved a price by ₱1" is the kind of thing
 * that reaches a customer before it reaches a developer.
 */
export function catalogueMotorPrice(
  m: MotorRow,
  exproof: boolean,
  prices: MotorPriceMap | null | undefined,
): number | null {
  if (!prices) return null;
  const ex = exproofApplies(m, exproof);
  const code = fanMotorCode(m.hp, m.phase, m.pole, ex);
  const hit = prices[code];
  if (typeof hit === "number" && Number.isFinite(hit) && hit > 0) return hit;
  /**
   * An explosion-proof row that is missing falls back to the STANDARD catalogue
   * price for the same motor, not straight to the code table — otherwise
   * deleting one EX row would quietly revert that motor to code-table pricing
   * for its standard price too, which is a much bigger change than the one that
   * was made.
   */
  if (ex) {
    const std = prices[fanMotorCode(m.hp, m.phase, m.pole)];
    if (typeof std === "number" && Number.isFinite(std) && std > 0) return std;
  }
  return null;
}

/** A price is only a price if it is a positive finite number. */
const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * The mounting a standalone motor line asks for.
 *
 * The quotation builder stores the label ("Foot Mounted" / "Flanged Mounted"),
 * so the mapping lives here beside the codes rather than being re-derived at
 * each call site.
 */
export function mountingOf(label: string | undefined | null): MotorMounting {
  return label === "Flanged Mounted" ? "flange" : "foot";
}

/**
 * Standalone TECO price from the catalogue, or null to fall back to the file.
 *
 * Flange falls back to FOOT — the same rule `tecoNetPrice` applies, because
 * explosion-proof, single-phase and the largest three-phase frames are offered
 * foot-mounted only. Keeping the rule identical is what lets the catalogue be a
 * drop-in: a flange row that does not exist behaves exactly as it always did.
 */
export function catalogueTecoPrice(
  section: TecoSection,
  hp: number,
  pole: number,
  mounting: MotorMounting,
  prices: MotorPriceMap | null | undefined,
): number | null {
  if (!prices) return null;
  if (mounting === "flange") {
    const flange = prices[tecoCode(section, hp, pole, "flange")];
    if (usable(flange)) return flange;
  }
  const foot = prices[tecoCode(section, hp, pole, "foot")];
  return usable(foot) ? foot : null;
}

/** …and the same for Hyundai, whose range is 3-phase TEFC only. */
export function catalogueHyundaiPrice(
  hp: number,
  pole: number,
  mounting: MotorMounting,
  prices: MotorPriceMap | null | undefined,
): number | null {
  if (!prices) return null;
  if (mounting === "flange") {
    const flange = prices[hyundaiCode(hp, pole, "flange")];
    if (usable(flange)) return flange;
  }
  const foot = prices[hyundaiCode(hp, pole, "foot")];
  return usable(foot) ? foot : null;
}
