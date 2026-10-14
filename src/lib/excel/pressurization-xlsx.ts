/**
 * The stair pressurization calculation sheet — what the floor-by-floor tool
 * downloads for a consultant or a submittal: the criteria and inputs, one row
 * per floor (height, pressure, leakage, door force, check), the airflow
 * build-up, the fan duty and the method. Built from scratch with ExcelJS, in
 * the house style of the job-order sheets.
 */
import ExcelJS from "exceljs";
import { COMPANY } from "@/lib/config";
import { levelName, type PressInput, type PressResult } from "@/lib/hvac/pressurization";

const RED = "FFED1C24";
const GREY = "FFF2F2F2";
const BORDER = "FFBFBFBF";
const OK = "FF15803D";
const BAD = "FFB91C1C";
const WARN = "FFB45309";

export async function buildPressurizationWorkbook(opts: {
  project: string;
  criteria: string;
  input: PressInput;
  result: PressResult;
  preparedBy: string;
  date: string;
}): Promise<Buffer> {
  const { project, criteria, input: i, result: r } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  const ws = wb.addWorksheet("Stair pressurization", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false, style: "pageBreakPreview", zoomScale: 120, zoomScaleNormal: 120 }],
  });
  ws.columns = [{ width: 12 }, { width: 13 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 14 }];
  const thin = { style: "thin" as const, color: { argb: BORDER } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = COMPANY.name;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: RED } };
  ws.mergeCells("A2:F2");
  ws.getCell("A2").value = "STAIR PRESSURIZATION — DESIGN CALCULATION";
  ws.getCell("A2").font = { bold: true, size: 12 };
  ws.mergeCells("A3:F3");
  ws.getCell("A3").value = `${project || "Stair pressurization"}   ·   ${opts.date}   ·   Prepared by ${opts.preparedBy}`;
  ws.getCell("A3").font = { size: 10, color: { argb: "FF555555" } };

  let row = 5;
  const section = (title: string) => {
    ws.mergeCells(`A${row}:F${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = title;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    row++;
  };
  const pair = (label: string, value: string | number, unit = "", bold = false) => {
    ws.mergeCells(`A${row}:C${row}`);
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`D${row}`).value = value;
    ws.getCell(`D${row}`).alignment = { horizontal: "right" };
    ws.getCell(`E${row}`).value = unit;
    for (const col of ["A", "D", "E"]) {
      ws.getCell(`${col}${row}`).border = { bottom: thin };
      if (bold) ws.getCell(`${col}${row}`).font = { bold: true };
    }
    row++;
  };

  section("CRITERIA");
  pair("Standard", criteria);
  pair("Design pressure (weakest floor)", i.designPa, "Pa");
  pair("Minimum pressure", i.minPa, "Pa");
  pair("Door-opening force limit", i.doorForceLimitN, "N");
  pair("Air through the open fire-floor door", i.openDoorVelocity > 0 ? i.openDoorVelocity : "— (no open-door case)", i.openDoorVelocity > 0 ? "m/s" : "");
  row++;

  section("THE STAIR");
  pair("Floors above ground (schedule G to top)", i.floors);
  pair("Floor-to-floor height", i.floorHeight, "m");
  pair("Outdoor / stair temperature", `${i.outdoorC} / ${i.stairC}`, "°C");
  pair("Stair door (W × H)", `${i.doorWidth} × ${i.doorHeight}`, "m");
  pair("Leakage area — each floor door", i.doorLeakArea, "m²");
  pair("Leakage area — ground exit door", i.exitLeakArea, "m²");
  if (i.otherLeakArea > 0) pair("Other leakage per floor", i.otherLeakArea, "m²");
  pair("Door closer force", i.closerForceN, "N");
  pair("Fire floor (door open)", levelName(i.fireFloor));
  row++;

  section("FLOOR SCHEDULE");
  const head = ["Floor", "Height (m)", "ΔP (Pa)", "Leakage (m³/s)", "Door force (N)", "Check"];
  head.forEach((h, k) => {
    const c = ws.getRow(row).getCell(k + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
    c.border = box;
    c.alignment = { horizontal: k === 0 || k === 5 ? "left" : "right" };
  });
  row++;
  for (const f of [...r.rows].reverse()) {
    const cells: (string | number)[] = [f.name + (f.level === i.fireFloor ? " (fire)" : ""), f.heightM, f.dpPa, f.leakageM3s, f.doorForceN, f.status === "ok" ? "OK" : f.status === "over" ? "Over door-force limit" : "Under minimum"];
    cells.forEach((v, k) => {
      const c = ws.getRow(row).getCell(k + 1);
      c.value = v;
      c.border = box;
      c.alignment = { horizontal: k === 0 || k === 5 ? "left" : "right" };
      if (k === 1) c.numFmt = "0.0";
      if (k === 2) c.numFmt = "0.0";
      if (k === 3) c.numFmt = "0.000";
      if (k === 5) c.font = { bold: true, color: { argb: f.status === "ok" ? OK : f.status === "over" ? BAD : WARN } };
    });
    row++;
  }
  row++;

  section("AIRFLOW AND FAN");
  pair("Stack effect over the stair", r.stackPa, "Pa");
  pair("Highest pressure the door force allows", r.maxPaForDoorForce, "Pa");
  pair("Leakage, all doors closed", r.leakClosedM3s, "m³/s");
  if (r.openDoorM3s > 0) {
    pair(`Open door ${levelName(i.fireFloor)}: ${i.openDoorVelocity} m/s × ${(i.doorWidth * i.doorHeight).toFixed(2)} m²`, r.openDoorM3s, "m³/s");
    pair("Open-door case (open door + other doors' leakage)", r.openCaseM3s, "m³/s");
  }
  pair(`Governing case + ${i.ductLeakPct}% duct leakage`, r.fanM3s, "m³/s");
  pair("FAN AIRFLOW", r.fanCfm, "CFM", true);
  pair(`Fan pressure (top floor + ${i.systemLossPa} Pa losses)`, r.fanPa, "Pa", true);
  pair("", r.fanInwg, "in.wg", true);
  if (r.reliefAreaM2 > 0) pair("Relief vent free area", r.reliefAreaM2, "m²");
  row++;

  if (r.overFloors.length || r.underFloors.length) {
    section("FLAGS");
    const lines = [
      r.overFloors.length ? `${r.overFloors.join(", ")}: over the ${r.maxPaForDoorForce} Pa a ${i.doorForceLimitN} N door force allows — provide pressure relief at these floors, split the stair into zones, or revise the design pressure.` : "",
      r.underFloors.length ? `${r.underFloors.join(", ")}: below the ${i.minPa} Pa minimum — raise the design pressure.` : "",
    ].filter(Boolean);
    for (const t of lines) {
      ws.mergeCells(`A${row}:F${row}`);
      ws.getCell(`A${row}`).value = t;
      ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
      ws.getRow(row).height = 30;
      row++;
    }
    row++;
  }

  section("METHOD");
  const method = [
    "Closed-door leakage Q = 0.83 · A · ΔP^0.5 (m³/s; A in m², ΔP in Pa) — EN 12101-6.",
    "Stack effect ΔP(h) = ΔP(ref) + 3460 · (1/T_out − 1/T_stair) · (h − ref), T in K. The fan is sized so the weakest floor holds the design pressure.",
    "Door-opening force F = F_closer + W · A · ΔP / (2 · (W − 0.075)) (N).",
    "Open-door case: the fire-floor door open at the stated velocity; the other floors at their closed-door pressures.",
    "Relief vent A = (open-door case − closed-door leakage) / (0.83 · ΔP_design^0.5).",
    "Criteria are starting figures; confirm against the Fire Code of the Philippines (RA 9514 IRR) and the PSME Code for the project.",
  ];
  for (const t of method) {
    ws.mergeCells(`A${row}:F${row}`);
    ws.getCell(`A${row}`).value = t;
    ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(`A${row}`).font = { size: 9 };
    ws.getRow(row).height = 26;
    row++;
  }

  ws.pageSetup.printArea = `A1:F${row}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
