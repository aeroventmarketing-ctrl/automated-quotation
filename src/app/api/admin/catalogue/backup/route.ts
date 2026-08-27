/**
 * Catalogue backup download — `?format=csv` (default) or `?format=xlsx`.
 *
 * Admin only, and re-checked here: the /admin layout guard does not cover
 * /api/*, so a route that skipped this would be an open catalogue dump.
 */
import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { buildCatalogueBackup, catalogueBackupCsv, CATALOGUE_BACKUP_COLUMNS } from "@/lib/catalogue-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dated, so successive backups sit side by side in a folder instead of
 *  overwriting each other in the browser's downloads. */
function filename(ext: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `aerovent-catalogue-${d}.${ext}`;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const rows = await buildCatalogueBackup();

  if (req.nextUrl.searchParams.get("format") === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Catalogue");
    ws.addRow([...CATALOGUE_BACKUP_COLUMNS]).font = { bold: true };
    for (const r of rows) ws.addRow(CATALOGUE_BACKUP_COLUMNS.map((c) => r[c]));
    // Every cell stays text. Excel would otherwise read specsJson as a formula
    // risk and, worse, "reformat" model codes like 25GSC or 1E5 into numbers —
    // which is exactly the corruption a backup must not introduce.
    ws.columns.forEach((col, i) => {
      col.width = [16, 16, 46, 34, 14, 10, 14, 10, 40, 9][i] ?? 18;
      col.numFmt = "@";
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CATALOGUE_BACKUP_COLUMNS.length } };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename("xlsx")}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(catalogueBackupCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename("csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}
