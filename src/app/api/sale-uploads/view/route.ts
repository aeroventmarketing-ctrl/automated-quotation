import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { canViewSaleDocPath } from "@/lib/sale-doc-access";
import { downloadFromStorage, signedUrl } from "@/lib/storage";
import { renderXlsxAsHtml } from "@/lib/excel/xlsx-to-html";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * View a stored sale/inquiry document in the browser without downloading.
 * Spreadsheets (.xlsx/.xls) are rendered to an HTML preview; PDFs and images
 * are shown inline via a signed URL (browsers render those natively). Anything
 * else falls back to the inline signed URL too. Add ?download=1 to force a
 * download of the original file.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!(await canViewSaleDocPath(user, path))) {
    return NextResponse.json({ error: "You don't have permission to view this document." }, { status: 403 });
  }

  const name = req.nextUrl.searchParams.get("name") || path.split("/").pop() || "document";
  const ext = name.split(".").pop()?.toLowerCase() || "";

  // Download the original file.
  if (req.nextUrl.searchParams.get("download") !== null) {
    try {
      return NextResponse.redirect(await signedUrl(path, 120, name));
    } catch {
      return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
    }
  }

  // Spreadsheets / CSV → render to an HTML preview.
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls" || ext === "csv") {
    try {
      const { base64 } = await downloadFromStorage(path);
      const wb = new ExcelJS.Workbook();
      if (ext === "csv") {
        await wb.csv.read(Readable.from(Buffer.from(base64, "base64")));
      } else {
        await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
      }
      const html = renderXlsxAsHtml(wb, name);
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    } catch {
      // Fall through to the inline signed URL if the file can't be parsed.
    }
  }

  // Everything else (PDF, images, …) → inline signed URL; browsers render these.
  try {
    return NextResponse.redirect(await signedUrl(path, 120));
  } catch {
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
