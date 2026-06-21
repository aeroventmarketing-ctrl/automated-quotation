import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
wb.creator = "AeroQuote";

const HEAD = { argb: "FF1E3A8A" };       // dark blue header fill
const EX = { argb: "FFFFF3CD" };          // light yellow example fill
const white = { argb: "FFFFFFFF" };

function styleHeader(ws: ExcelJS.Worksheet, widths: number[]) {
  const row = ws.getRow(1);
  row.height = 20;
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: HEAD };
    c.font = { bold: true, color: white, size: 11 };
    c.alignment = { vertical: "middle", horizontal: "center" };
    c.border = { bottom: { style: "thin" } };
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}
function markExample(ws: ExcelJS.Worksheet, rowNum: number) {
  ws.getRow(rowNum).eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: EX };
    c.font = { italic: true };
  });
}

// ---------------------------------------------------------------- READ ME
const readme = wb.addWorksheet("READ ME");
readme.getColumn(1).width = 22;
readme.getColumn(2).width = 90;
const rm: [string, string][] = [
  ["AeroQuote import template", ""],
  ["", ""],
  ["How to use", "Fill the 3 sheets below (one row per item). Yellow rows are EXAMPLES — delete them before sending. Keep the header row (row 1) exactly as-is."],
  ["Send it back", "When done, upload this file to the GitHub repo (or send it) and I'll convert + prepare it for import. You don't need to convert units — fill in the units shown."],
  ["", ""],
  ["Sheet 1: Catalogue", "Your product list. ONE row per fan/model/accessory. This is the foundation — everything attaches to 'modelCode'."],
  ["Sheet 2: Performance", "Fan curve data, in YOUR units (CFM, inches w.g., BHP). ONE row per operating point. I convert to metric for you."],
  ["Sheet 3: Prices", "Selling price (PHP) per model, plus optional priced add-ons."],
  ["", ""],
  ["Key rule", "The same 'modelCode' must be spelled IDENTICALLY across all three sheets (e.g. 1225CEB)."],
  ["", ""],
  ["family values", "Use exactly one of: CENTRIFUGAL, AXIAL, PROPELLER, TUBULAR_INLINE, CABINET, ACCESSORY, SERVICE, OTHER"],
];
rm.forEach(([a, b], i) => {
  const r = readme.getRow(i + 1);
  r.getCell(1).value = a;
  r.getCell(2).value = b;
  r.getCell(1).font = { bold: true, size: i === 0 ? 14 : 11 };
  r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  r.getCell(2).font = { size: 11 };
});

// ---------------------------------------------------------------- CATALOGUE
const cat = wb.addWorksheet("Catalogue");
cat.columns = [
  { header: "modelCode" },
  { header: "family" },
  { header: "name" },
  { header: "description" },
  { header: "sizeLabel" },
  { header: "uom" },
  { header: "wheelType" },
  { header: "arrangement" },
  { header: "wheelDia_in" },
  { header: "outletArea_ft2" },
  { header: "FEG" },
] as Partial<ExcelJS.Column>[];
cat.addRow([
  "1225CEB", "CENTRIFUGAL", "BC SWSI Blower 1225CEB",
  "Backward-curved single-width single-inlet centrifugal blower",
  "12.25 in", "unit", "backward-curved", "SWSI", 12.25, 0.86, 80,
]);
styleHeader(cat, [12, 16, 26, 40, 12, 8, 16, 13, 12, 14, 8]);
markExample(cat, 2);
// helper note row
cat.getCell("A4").value = "Required: modelCode, family, name. Everything else optional. wheelType/arrangement/wheelDia/outletArea/FEG are saved as specs.";
cat.getCell("A4").font = { italic: true, color: { argb: "FF6B7280" }, size: 10 };

// ---------------------------------------------------------------- PERFORMANCE
const perf = wb.addWorksheet("Performance");
perf.columns = [
  { header: "modelCode" },
  { header: "rpm" },
  { header: "cfm" },
  { header: "staticPressure_inwg" },
  { header: "bhp" },
  { header: "efficiency_pct" },
] as Partial<ExcelJS.Column>[];
const perfEx: (string | number)[][] = [
  ["1225CEB", 1400, 1500, 0.5, 0.21, ""],
  ["1225CEB", 1700, 2500, 0.5, 0.37, ""],
  ["1225CEB", 1850, 1500, 1.0, 0.48, ""],
  ["1225CEB", 2400, 3500, 1.0, 1.05, ""],
  ["1225CEB", 2700, 2000, 2.0, 1.50, ""],
];
perfEx.forEach((r) => perf.addRow(r));
styleHeader(perf, [12, 10, 10, 22, 10, 16]);
for (let i = 2; i <= 6; i++) markExample(perf, i);
perf.getCell("A8").value =
  "ONE row per operating point. From a rating table: for each CFM row and each \"x inch SP\" column, read the RPM and BHP and add a row. Units: CFM, inches w.g., BHP. efficiency optional.";
perf.getCell("A8").font = { italic: true, color: { argb: "FF6B7280" }, size: 10 };
perf.getCell("A8").alignment = { wrapText: true };
perf.mergeCells("A8:F9");

// ---------------------------------------------------------------- PRICES
const price = wb.addWorksheet("Prices");
price.columns = [
  { header: "modelCode" },
  { header: "basePrice_PHP" },
  { header: "option1_name" },
  { header: "option1_price" },
  { header: "option2_name" },
  { header: "option2_price" },
  { header: "option3_name" },
  { header: "option3_price" },
] as Partial<ExcelJS.Column>[];
price.addRow([
  "1225CEB", 45000, "Epoxy coating", 2200, "SS304 wheel", 18000, "", "",
]);
styleHeader(price, [12, 14, 18, 14, 18, 14, 18, 14]);
markExample(price, 2);
price.getCell("A4").value =
  "Required: modelCode, basePrice_PHP. Options are priced add-ons (name + price). Leave option columns blank if none.";
price.getCell("A4").font = { italic: true, color: { argb: "FF6B7280" }, size: 10 };

(async () => {
  const path = "/tmp/AeroQuote-Import-Template.xlsx";
  await wb.xlsx.writeFile(path);
  console.log("wrote", path);
})();
