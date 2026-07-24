import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { downloadFromStorage, signedUrl } from "@/lib/storage";
import { renderXlsxAsHtml } from "@/lib/excel/xlsx-to-html";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * View a stored cash-request document (liquidation receipt, …) in the browser
 * without downloading — the "eye" view. Spreadsheets render to an HTML preview;
 * PDFs and images show inline via a short-lived signed URL. Add ?download=1 to
 * force a download. Internal-only and scoped to cashrequests/.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!path.startsWith("cashrequests/")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const name = req.nextUrl.searchParams.get("name") || path.split("/").pop() || "document";
  const ext = name.split(".").pop()?.toLowerCase() || "";

  if (req.nextUrl.searchParams.get("download") !== null) {
    try {
      return NextResponse.redirect(await signedUrl(path, 120, name));
    } catch {
      return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
    }
  }

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
      // Fall through to the inline signed URL.
    }
  }

  try {
    return NextResponse.redirect(await signedUrl(path, 120));
  } catch {
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
