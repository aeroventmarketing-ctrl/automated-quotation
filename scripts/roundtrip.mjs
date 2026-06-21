import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("/tmp/orig.xlsx");
const ws = wb.worksheets[0];
ws.getCell("B19").value = "ExcelJS Test Client";
await wb.xlsx.writeFile("/tmp/roundtrip.xlsx");
console.log("wrote roundtrip; media:", wb.model.media?.length ?? 0);
