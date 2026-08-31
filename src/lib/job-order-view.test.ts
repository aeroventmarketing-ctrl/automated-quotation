/**
 * The eye-view of a job order shows THIS job order, not the template's ghost.
 *
 * Owner's bug report: *"when eye view is pressed, drive motor is always 15HP but
 * in Print Job Order button, job order is correct… This error exist in all roles
 * at eye view button."*
 *
 * The cause was not the data. A Fans & Blowers job order is a printable sheet of
 * formulas over a hidden Source sheet, and every formula in the shipped template
 * carries a CACHED result from whenever it was last saved in Excel — a real
 * order, `AFBM-JO2600055` of 6 July 2026, 15 HP, belt drive. Excel recalculates
 * on open (`fullCalcOnLoad`), so the download was always right; the headless
 * LibreOffice that renders the preview does not, so it printed the ghost.
 *
 * These assert on the FILE the view path hands the renderer: no cached results
 * survive, so nothing can be printed from cache. (Verified once by hand against
 * a real LibreOffice: the preview went from JO2600055/"Belt" to JO2600084/
 * "Direct" with no change to the builder.)
 */
import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";
import { buildFansJobOrderWorkbook } from "@/lib/excel/job-order-xlsx";
import { EMPTY_FANS_JO, JO_TYPES } from "@/lib/job-order";
import { joXlsxResponse, dropStaleFormulaCaches } from "@/lib/job-order-response";

const JO = {
  ...EMPTY_FANS_JO,
  type: "tubeaxial_vaneaxial",
  joNumber: "AFBM-JO2600084",
  date: "2026-08-29", targetDate: "2026-09-07",
  project: "TAFDD", make: "Standard", quantity: "1", uom: "pc.",
  bladeDiameter: "20", driveType: "Direct", directDrive: true,
  motorHp: "5 HP, 3PH, TECO", voltage: "440", frequency: "60",
};

/** Every `<c>` that holds a formula AND a cached result, across every sheet. */
async function cachedFormulaCells(buf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  let n = 0;
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    n += (xml.match(/<c\b[^>]*>(?:<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>)<v\b[^>]*>[\s\S]*?<\/v>/g) ?? []).length;
  }
  return n;
}
const template = (file: string) => fs.readFile(path.join(process.cwd(), "public/templates", file));
const bodyOf = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe("the job-order eye view", () => {
  it("hands the renderer a file with no cached formula results", async () => {
    const built = await buildFansJobOrderWorkbook(await template("fans-axial-jo-template.xlsx"), JO as never, {});
    // The builder's own output still carries the template's ghost…
    expect(await cachedFormulaCells(built)).toBeGreaterThan(0);
    // …and the view path removes every one of them before rendering.
    expect(await cachedFormulaCells(await dropStaleFormulaCaches(built))).toBe(0);
  });

  // The download opens in Excel, which honours fullCalcOnLoad and has always
  // been correct. Changing that file would be risk without benefit.
  it("leaves the download byte-for-byte alone", async () => {
    const built = await buildFansJobOrderWorkbook(await template("fans-axial-jo-template.xlsx"), JO as never, {});
    const dl = await bodyOf(await joXlsxResponse(new Request("https://x/jo/0/xlsx"), built, "jo.xlsx"));
    expect(dl.equals(built)).toBe(true);
  });

  // No converter is configured in tests, so ?view=1 falls through to the HTML
  // preview — which used to print the ghost for every composite formula.
  it("never serves the ghost job order in the HTML preview", async () => {
    const built = await buildFansJobOrderWorkbook(await template("fans-axial-jo-template.xlsx"), JO as never, {});
    const res = await joXlsxResponse(new Request("https://x/jo/0/xlsx?view=1"), built, "jo.xlsx");
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).not.toContain("2600055");   // the template's ghost
    expect(html).toContain("2600084");       // this job order
  });

  // All six Fans templates ship with the same ghost — the bug was never about
  // one form, and neither is the fix.
  it("clears the ghost from every Fans & Blowers template", async () => {
    for (const def of JO_TYPES.filter((t) => t.template)) {
      const built = await buildFansJobOrderWorkbook(await template(def.template!), { ...JO, type: def.key } as never, {});
      expect(await cachedFormulaCells(built), `${def.key} before`).toBeGreaterThan(0);
      expect(await cachedFormulaCells(await dropStaleFormulaCaches(built)), `${def.key} after`).toBe(0);
    }
  });
});
