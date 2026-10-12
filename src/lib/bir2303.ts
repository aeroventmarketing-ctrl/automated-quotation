/**
 * BIR Form 2303 — the client's Certificate of Registration.
 *
 * The owner, teaching the form off a real one: *"TIN & Branch Code is
 * 201-616-609-0000[0], Name of Taxpayer is Gil, Reyjellan Latican, TIN Issuance
 * Date is January 29, 1999, Taxpayer Type is Single Proprietorship Only,
 * Registered Address is 7635 Narra Road Bayan-bayanan San Vicente 4023 San Pedro
 * Laguna Philippines"* — then: *"Add the following in Client Details … Add a link
 * wherein the sales role or accounting role can upload the BIR 2303, put an
 * eyeview and use AI reading to autofill the additional fields."*
 *
 * The 2303 is what the VAT-inclusive, VAT-exclusive (+12%) and zero-rated
 * transactions will lean on, so these five fields are the client's tax identity.
 *
 * Storage: the Customer table has no column for any of this and gets none — like
 * the TIN before it, it rides in the account registry (`AccountData`). The TIN
 * keeps its existing slot (`AccountData.tin`, read by the Sales Summary), so the
 * 2303's "TIN & Branch Code" and the TIN the reports already print are one value.
 *
 * Pure: no database, no AI. The route and the actions do the I/O.
 */

export interface Bir2303Doc {
  path: string;
  name: string;
  uploadedAt: string;
  byName?: string;
}

/** What the registry holds for a client's 2303, besides the TIN. */
export interface Bir2303Record {
  taxpayerName?: string;
  /** YYYY-MM-DD. */
  tinIssuedOn?: string;
  taxpayerType?: string;
  registeredAddress?: string;
  /** The uploaded certificate — the eye opens this. */
  doc?: Bir2303Doc;
  /** AI reads per uploaded file — capped, like every other AI reader. */
  readCounts?: Record<string, number>;
  /** Who last saved the fields, and when. */
  updatedByName?: string;
  updatedAt?: string;
}

/** Where a client's 2303 uploads live in the bucket. A path outside it is refused. */
export const bir2303Prefix = (customerId: string) => `customers/${customerId}/bir2303/`;
export const isBir2303Path = (customerId: string, path: string) =>
  !!customerId && path.startsWith(bir2303Prefix(customerId)) && !path.includes("..");

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Read a stored record defensively — anything malformed is dropped, never thrown. */
export function coerceBir2303(v: unknown): Bir2303Record | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const d = o.doc as Record<string, unknown> | undefined;
  const doc: Bir2303Doc | undefined =
    d && typeof d === "object" && typeof d.path === "string" && d.path
      ? { path: d.path, name: str(d.name) ?? d.path.split("/").pop() ?? "BIR 2303", uploadedAt: str(d.uploadedAt) ?? "", ...(str(d.byName) ? { byName: str(d.byName) } : {}) }
      : undefined;
  const counts: Record<string, number> = {};
  if (o.readCounts && typeof o.readCounts === "object" && !Array.isArray(o.readCounts)) {
    for (const [k, n] of Object.entries(o.readCounts as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n) && n > 0) counts[k] = Math.floor(n);
    }
  }
  const issued = str(o.tinIssuedOn);
  const rec: Bir2303Record = {
    ...(str(o.taxpayerName) ? { taxpayerName: str(o.taxpayerName) } : {}),
    ...(issued && /^\d{4}-\d{2}-\d{2}$/.test(issued) ? { tinIssuedOn: issued } : {}),
    ...(str(o.taxpayerType) ? { taxpayerType: str(o.taxpayerType) } : {}),
    ...(str(o.registeredAddress) ? { registeredAddress: str(o.registeredAddress) } : {}),
    ...(doc ? { doc } : {}),
    ...(Object.keys(counts).length ? { readCounts: counts } : {}),
    ...(str(o.updatedByName) ? { updatedByName: str(o.updatedByName) } : {}),
    ...(str(o.updatedAt) ? { updatedAt: str(o.updatedAt) } : {}),
  };
  return Object.keys(rec).length ? rec : undefined;
}

// --- TIN & Branch Code ------------------------------------------------------

/**
 * Put a TIN in the form BIR prints it: `000-000-000` then the branch code.
 *
 * The branch code is **3 digits** on older certificates (`000`) and **5** on the
 * current ones (`00000` — the owner's sample reads `201-616-609-00000`), and the
 * head office is all zeros. Both are kept exactly as given: the digits are never
 * padded or trimmed, because a branch code that gained or lost a zero names a
 * different registration. A bare 9-digit TIN (no branch) is accepted as is.
 *
 * Anything else is refused with the reason, rather than saved and printed wrong.
 */
export function formatTin(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return { ok: true, value: "" };
  if (![9, 12, 14].includes(digits.length)) {
    return {
      ok: false,
      error: `A TIN is 9 digits, followed by a 3- or 5-digit branch code (e.g. 201-616-609-00000) — this has ${digits.length} digits.`,
    };
  }
  const base = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  return { ok: true, value: digits.length === 9 ? base : `${base}-${digits.slice(9)}` };
}

// --- TIN Issuance Date ------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The issuance date as YYYY-MM-DD, from either that form or the way the
 * certificate prints it ("January 29, 1999", "Jan 29 1999"). Null when it isn't
 * a real calendar date — Feb 30 is refused, not rolled into March.
 */
export function parseIssuedOn(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const long = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (long) {
    const word = long[1].toLowerCase();
    const idx = MONTHS.findIndex((name) => name === word || (word.length >= 3 && name.startsWith(word)));
    if (idx < 0) return null;
    [y, m, d] = [Number(long[3]), idx + 1, Number(long[2])];
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "1999-01-29" → "January 29, 1999" — how the certificate itself prints it. */
export function formatIssuedOn(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "");
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return `${month[0].toUpperCase()}${month.slice(1)} ${Number(m[3])}, ${m[1]}`;
}

// --- The AI read ------------------------------------------------------------

/** What the reader returns, before it is trusted with anything. */
export interface Bir2303Read {
  isBir2303?: boolean | null;
  tin?: string | null;
  taxpayerName?: string | null;
  tinIssuedOn?: string | null;
  taxpayerType?: string | null;
  registeredAddress?: string | null;
  confidence?: number | null;
  warnings?: string[];
}

/** The five fields, as the form shows them — every one a string, "" when unread. */
export interface Bir2303Fields {
  tin: string;
  taxpayerName: string;
  tinIssuedOn: string;
  taxpayerType: string;
  registeredAddress: string;
}

/**
 * Turn a read into form values plus the warnings a person should see. A field
 * the code can't stand behind (a TIN with the wrong number of digits, a date
 * that isn't one) comes back EMPTY with a warning — an empty box gets typed in;
 * a wrong one gets saved.
 */
export function fieldsFromRead(r: Bir2303Read): { fields: Bir2303Fields; warnings: string[] } {
  const warnings = [...(r.warnings ?? [])].filter((w) => typeof w === "string" && w.trim());
  if (r.isBir2303 === false) warnings.unshift("This doesn't look like a BIR Form 2303 — check that the right file was uploaded.");

  let tin = "";
  if (r.tin?.trim()) {
    const t = formatTin(r.tin);
    if (t.ok) tin = t.value;
    else warnings.push(`TIN not filled in — the read "${r.tin.trim()}" isn't a valid TIN & branch code.`);
  }
  let tinIssuedOn = "";
  if (r.tinIssuedOn?.trim()) {
    const d = parseIssuedOn(r.tinIssuedOn);
    if (d) tinIssuedOn = d;
    else warnings.push(`TIN issuance date not filled in — couldn't read "${r.tinIssuedOn.trim()}" as a date.`);
  }
  if (typeof r.confidence === "number" && r.confidence < 0.7) {
    warnings.push("The image isn't clear enough for a reliable read — check every field against the certificate.");
  }
  return {
    fields: {
      tin,
      taxpayerName: r.taxpayerName?.trim() ?? "",
      tinIssuedOn,
      taxpayerType: r.taxpayerType?.trim() ?? "",
      registeredAddress: r.registeredAddress?.trim().replace(/\s+/g, " ") ?? "",
    },
    warnings,
  };
}

/** The reader's instructions, taught off the owner's sample certificate. */
export const BIR2303_SYSTEM = `You read a Philippine BIR Form 2303 — the "CERTIFICATE OF REGISTRATION" issued by the Bureau of Internal Revenue (Kawanihan ng Rentas Internas) — and capture five fields of the taxpayer it registers.

THE FIVE FIELDS, and where they are on the form:
1. TIN & BRANCH CODE — the box labelled "TIN & BRANCH CODE", top-left of the details table. Copy the digits EXACTLY as printed, with dashes, e.g. "201-616-609-00000". The branch code after the third dash is 3 digits on older forms ("000") and 5 digits on current ones ("00000"): never add or drop a digit.
2. NAME OF TAXPAYER — the box labelled "NAME OF TAXPAYER" (an individual is printed SURNAME, GIVEN NAMES). This is NOT the trade name in "BUSINESS INFORMATION DETAILS".
3. TIN ISSUANCE DATE — the box labelled "TIN ISSUANCE DATE". Return YYYY-MM-DD. Do NOT use the "Date OCN Generated", a filing start date or the business registration date.
4. TAXPAYER TYPE — the row labelled "TAXPAYER TYPE/S". Return the type itself without the parenthetical residency note, e.g. "SINGLE PROPRIETORSHIP ONLY (RESIDENT CITIZEN)" → "Single Proprietorship Only".
5. REGISTERED ADDRESS — the row labelled "REGISTERED ADDRESS", as one line.

CASING: write names and addresses the way a person would type them — Title Case, not ALL CAPS — e.g. "GIL, REYJELLAN LATICAN" → "Gil, Reyjellan Latican"; "7635 NARRA ROAD BAYAN-BAYANAN SAN VICENTE 4023 SAN PEDRO LAGUNA PHILIPPINES" → "7635 Narra Road Bayan-bayanan San Vicente 4023 San Pedro Laguna Philippines". Keep company suffixes and acronyms as normally written ("Inc.", "Corp.", "OPC", "ABC Steel Corp.").

RULES:
- Read only what is printed. The "BUREAU OF INTERNAL REVENUE" security background text is not content.
- ACCURACY OVER COMPLETENESS: if a field is cut off, blurred or under glare and you are not sure of it EXACTLY, return null for it and add a warning. Never guess a digit.
- If the document is not a BIR Form 2303, set isBir2303 to false.
Return STRICT JSON only.`;

export const BIR2303_USER_PROMPT = `From the attached BIR Form 2303, return JSON with exactly this shape:
{
  "isBir2303": boolean,               // is this a BIR Form 2303 Certificate of Registration?
  "tin": string|null,                 // TIN & BRANCH CODE exactly as printed, with dashes
  "taxpayerName": string|null,        // NAME OF TAXPAYER, Title Case
  "tinIssuedOn": string|null,         // TIN ISSUANCE DATE as YYYY-MM-DD
  "taxpayerType": string|null,        // TAXPAYER TYPE/S without the parenthetical, Title Case
  "registeredAddress": string|null,   // REGISTERED ADDRESS on one line, Title Case
  "confidence": number,               // 0..1 — how sure you are of the exact TIN digits and the date
  "warnings": [ string ]              // e.g. "TIN partly covered by a stamp"
}`;
