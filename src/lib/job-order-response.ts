import ExcelJS from "exceljs";
import { renderXlsxAsHtml } from "@/lib/excel/xlsx-to-html";

/**
 * Turn a built job-order .xlsx buffer into an HTTP response. By default the file
 * downloads (Content-Disposition: attachment). When the request carries `?view=1`
 * the same workbook is rendered to an HTML preview so it can be viewed in the
 * browser without downloading — the "eye" View action on each job order.
 */
export async function joXlsxResponse(req: Request, buffer: Buffer, filename: string): Promise<Response> {
  const wantsView = new URL(req.url).searchParams.get("view") !== null;
  if (wantsView) {
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
