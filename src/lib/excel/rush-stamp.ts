import JSZip from "jszip";

/**
 * Stamp RUSH on a printed .xlsx (a Job Order, a PO) — lib/rush-order: the owner
 * wants the printed Job Order, MRF and PO to carry it.
 *
 * Written into each worksheet's PRINT HEADER (`<headerFooter><oddHeader>`), top
 * right, in bold red — not into a cell. The templates are laid out to the cell
 * and some ship protected; a header changes no cell, no formula, no protection,
 * and prints on every page (Excel and LibreOffice alike, so the View shows it).
 *
 * An existing odd header keeps its left / centre parts; only the right part
 * becomes the stamp. Never throws: an unreadable file is returned unchanged —
 * a Job Order without the stamp beats no Job Order.
 */
export async function stampRushXlsx(buffer: Buffer, text: string, opts: { sheetName?: RegExp } = {}): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const right = `&amp;R&amp;"Arial,Bold"&amp;16&amp;KFF0000${escapeXml(text)}`;
    // Only the named sheets, when asked — the PO workbook also carries the BIR
    // 2307, a government form that must not be marked.
    const only = opts.sheetName ? await sheetFilesNamed(zip, opts.sheetName) : null;
    let touched = false;
    for (const name of Object.keys(zip.files)) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      if (only && !only.has(name)) continue;
      const xml = await zip.file(name)!.async("string");
      const next = withRushHeader(xml, right);
      if (next !== xml) {
        zip.file(name, next);
        touched = true;
      }
    }
    return touched ? await zip.generateAsync({ type: "nodebuffer" }) : buffer;
  } catch {
    return buffer;
  }
}

/** The part names (xl/worksheets/sheetN.xml) of the sheets whose tab name matches. */
async function sheetFilesNamed(zip: JSZip, re: RegExp): Promise<Set<string>> {
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const t = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && t) target.set(id, `xl/${t.replace(/^\/?xl\//, "").replace(/^\//, "")}`);
  }
  const out = new Set<string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = (m[0].match(/\bname="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&");
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    if (rid && re.test(name) && target.has(rid)) out.add(target.get(rid)!);
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The sheet XML with `right` as the right part of its odd-page header. Placed
 * where the schema wants `<headerFooter>`: after `<pageSetup>` (else after
 * `<pageMargins>`, else after `<printOptions>`, else before `</worksheet>`'s
 * trailing parts) — Excel refuses a file whose elements are out of order.
 */
export function withRushHeader(xml: string, right: string): string {
  const hf = xml.match(/<headerFooter\b[^>]*\/>|<headerFooter\b[^>]*>[\s\S]*?<\/headerFooter>/);
  if (hf) {
    const block = hf[0];
    const odd = block.match(/<oddHeader>([\s\S]*?)<\/oddHeader>/);
    // Drop an existing right section (&R… up to the next &L / &C or the end).
    const kept = odd ? odd[1].replace(/&amp;R[\s\S]*?(?=&amp;[LC]|$)/, "") : "";
    const header = `<oddHeader>${kept}${right}</oddHeader>`;
    const nextBlock = block.endsWith("/>")
      ? block.replace(/\/>$/, `>${header}</headerFooter>`)
      : odd
        ? block.replace(/<oddHeader>[\s\S]*?<\/oddHeader>/, header)
        : block.replace(/^(<headerFooter\b[^>]*>)/, `$1${header}`);
    return xml.replace(block, nextBlock);
  }
  const header = `<headerFooter><oddHeader>${right}</oddHeader></headerFooter>`;
  for (const after of [/<pageSetup\b[^>]*\/>|<pageSetup\b[^>]*>[\s\S]*?<\/pageSetup>/, /<pageMargins\b[^>]*\/>/, /<printOptions\b[^>]*\/>/]) {
    const m = xml.match(after);
    if (m) return xml.replace(m[0], `${m[0]}${header}`);
  }
  // No print settings at all: before whatever may follow headerFooter, else the end.
  const tail = xml.match(/<(rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  if (tail) return xml.replace(tail[0], `${header}${tail[0]}`);
  return xml.replace(/<\/worksheet>\s*$/, `${header}</worksheet>`);
}
