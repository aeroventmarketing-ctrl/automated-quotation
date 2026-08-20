/**
 * Pixel-perfect .xlsx → PDF via an external LibreOffice converter.
 *
 * Vercel's serverless runtime can't run LibreOffice (too large, no system
 * binary), so a real "renders exactly like Excel" PDF is produced by a small
 * self-hosted converter service that the app calls over HTTP. The reference
 * implementation is **Gotenberg** (https://gotenberg.dev) — a container wrapping
 * LibreOffice: POST the file as multipart `files` to its LibreOffice route and
 * it returns `application/pdf`.
 *
 * Configuration (opt-in): set `XLSX_PDF_CONVERTER_URL` to the converter's full
 * convert endpoint, e.g. `https://converter.internal/forms/libreoffice/convert`.
 * When it's unset — or the conversion fails / times out — this returns `null`
 * and callers fall back to the in-app HTML preview, so nothing breaks.
 *
 * Privacy: prefer a converter you host yourself (the job-order documents stay
 * within your infrastructure). A third-party conversion API would send the file
 * off-site.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TIMEOUT_MS = 25_000;

export function xlsxPdfConfigured(): boolean {
  return !!process.env.XLSX_PDF_CONVERTER_URL?.trim();
}

export async function convertXlsxToPdf(
  buffer: Buffer,
  filename: string,
  opts?: { pageRanges?: string },
): Promise<Buffer | null> {
  const url = process.env.XLSX_PDF_CONVERTER_URL?.trim();
  if (!url) return null;

  const safe = (filename || "document.xlsx").replace(/[^A-Za-z0-9._-]/g, "_");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(buffer)], { type: XLSX_MIME }), safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`);
    // Limit the output to specific pages (Gotenberg/LibreOffice `nativePageRanges`,
    // e.g. "1-1"). The single-page forms otherwise emit a trailing blank page from
    // the template's print area.
    if (opts?.pageRanges) form.append("nativePageRanges", opts.pageRanges);
    // Optional auth: when the converter sits behind a basic-auth / token proxy,
    // set XLSX_PDF_CONVERTER_AUTH to the full header value (e.g. "Basic <b64>"
    // or "Bearer <token>") and it's sent verbatim.
    const auth = process.env.XLSX_PDF_CONVERTER_AUTH?.trim();
    const res = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal,
      ...(auth ? { headers: { Authorization: auth } } : {}),
    });
    if (!res.ok) {
      console.error("[xlsx-pdf] converter responded", res.status, res.statusText);
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("pdf")) {
      console.error("[xlsx-pdf] converter returned non-PDF content-type:", ct);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[xlsx-pdf] conversion failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
