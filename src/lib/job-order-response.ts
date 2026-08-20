import ExcelJS from "exceljs";
import { renderXlsxAsHtml } from "@/lib/excel/xlsx-to-html";
import { convertXlsxToPdf } from "@/lib/xlsx-pdf";

/**
 * Turn a built job-order .xlsx buffer into an HTTP response. By default the file
 * downloads (Content-Disposition: attachment). When the request carries `?view=1`
 * the "eye" View action wants an in-browser preview:
 *   - If an external LibreOffice converter is configured (XLSX_PDF_CONVERTER_URL),
 *     return a **pixel-perfect PDF** (renders exactly like Excel, logo & layout).
 *   - Otherwise fall back to the self-contained HTML preview.
 */
export async function joXlsxResponse(req: Request, buffer: Buffer, filename: string): Promise<Response> {
  const wantsView = new URL(req.url).searchParams.get("view") !== null;
  if (wantsView) {
    // Job Order forms are a single page; export only page 1 so the template's
    // print area doesn't tack on a trailing blank page.
    const pdf = await convertXlsxToPdf(buffer, filename, { pageRanges: "1-1" });
    if (pdf) {
      const pdfName = filename.replace(/\.xlsx$/i, ".pdf");
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdfName}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const html = renderXlsxAsHtml(wb, filename.replace(/\.xlsx$/i, ""));
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
