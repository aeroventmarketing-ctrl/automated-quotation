import ExcelJS from "exceljs";
import JSZip from "jszip";
import { renderXlsxAsHtml } from "@/lib/excel/xlsx-to-html";
import { convertXlsxToPdf } from "@/lib/xlsx-pdf";

/**
 * Drop every cached formula result, so a renderer has to compute the values
 * rather than print the ones the template was saved with.
 *
 * **The bug this fixes.** A Fans & Blowers job order is a printable sheet of
 * ~46 formulas over a hidden Source sheet, and Source itself holds ~19 VLOOKUPs.
 * The builder writes the new inputs into Source and sets `fullCalcOnLoad`, which
 * **Excel** honours — so the downloaded .xlsx has always been right. LibreOffice,
 * converting headless for the eye-view, does NOT recalculate OOXML by default:
 * it prints each formula's cached result, and those caches are whatever was on
 * screen when the template was last saved. Every order therefore previewed as
 * the same ghost job order — reported as *"drive motor is always 15HP"*, which
 * was really `AFBM-JO2600055` of 6 July 2026 showing through in its entirety.
 *
 * A cell with no cached result cannot be printed from cache, so the renderer
 * computes it. Verified against a real LibreOffice: before, the preview showed
 * JO2600055 and "Belt"; after, JO2600084 and "Direct", from the same builder.
 *
 * Only the **view** path is stripped. The download is untouched — Excel already
 * recalculates it, and there is nothing to gain by changing the file people
 * open in the tool it was written for.
 */
export async function dropStaleFormulaCaches(buffer: Buffer): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    // `<c ...><f>…</f><v>cached</v></c>` → `<c ...><f>…</f></c>`, on every sheet:
    // the hidden Source sheet caches its VLOOKUPs too, and a printable formula
    // reading a stale Source cell would still come out wrong.
    const cachedResult = /(<c\b[^>]*>(?:<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>))<v\b[^>]*>[\s\S]*?<\/v>/g;
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      const xml = await zip.file(name)!.async("string");
      zip.file(name, xml.replace(cachedResult, "$1"));
    }
    return await zip.generateAsync({ type: "nodebuffer" });
  } catch {
    // A preview is worth more than nothing: fall back to the original buffer.
    return buffer;
  }
}

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
    const fresh = await dropStaleFormulaCaches(buffer);
    // Job Order forms are a single page; export only page 1 so the template's
    // print area doesn't tack on a trailing blank page.
    const pdf = await convertXlsxToPdf(fresh, filename, { pageRanges: "1-1" });
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
    // The HTML fallback resolves single-reference formulas itself (see
    // xlsx-to-html) and fell back to the cached result for composite ones — which
    // is why the motor line, `TEXT(Source!D88,…)&" HP, "&…`, read 15 HP there
    // too. With the caches gone those cells come out EMPTY rather than wrong: a
    // blank field is visibly incomplete, where a stale one reads as authoritative.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fresh as unknown as ArrayBuffer);
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
