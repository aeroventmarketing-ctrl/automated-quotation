/**
 * Rich, fully-customizable marketing campaigns — the "email builder" behind the
 * Marketing page. Where {@link ./marketing.ts} handles the simple recurring
 * check-in (a subject + one message body), this builds a structured, sectioned
 * promotional email: sender, benefit-focused subject, preview text, personalized
 * greeting, an opening hook, the value proposition, featured products/services,
 * benefit bullets, uploaded visuals, social proof, a single primary call-to-action,
 * contact info, a footer and an unsubscribe line.
 *
 * Every section is optional — leave it blank and it's dropped from the email — so
 * one builder covers anything from a plain text note to a full product feature.
 *
 * The working draft rides in an AppSetting row (no schema change); images are
 * stored paths (resolved to URLs at render/send time). Personalization tokens
 * ({firstName} / {company} / {contactName}, plus [First Name]-style aliases) are
 * substituted per recipient.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMPANY, config } from "@/lib/config";
import { appendRfqPrefill, RFQ_PATH } from "@/lib/rfq-link";
import type { BuiltEmail } from "@/lib/follow-up-email";

export const MARKETING_CAMPAIGN_KEY = "marketing_campaign_draft";

/** One featured product / service tile. */
export interface CampaignProduct {
  name: string;
  blurb: string;
  imagePath?: string;
  imageName?: string;
}

/** One uploaded visual (hero / gallery). */
export interface CampaignImage {
  path: string;
  name: string;
  caption?: string;
}

/** The full, customizable campaign definition. Any blank field is omitted. */
export interface CampaignDraft {
  /** Display name in the From header, e.g. "Aerovent Fans and Blowers Manufacturing". */
  senderName: string;
  /** Short, benefit-focused subject line. Tokens allowed. */
  subject: string;
  /** Preheader / preview text shown beside the subject. */
  preheader: string;
  /** Greeting template, e.g. "Dear {firstName},". Tokens allowed. */
  greeting: string;
  /** Opening hook — lead with the customer's problem/opportunity. Tokens allowed. */
  hook: string;
  /** Main value proposition. Tokens allowed. */
  valueProp: string;
  /** Relevant products/services to feature (only what fits this campaign). */
  products: CampaignProduct[];
  /** Benefits (outcomes, not specs) — one per entry, rendered as bullets. */
  benefits: string[];
  /** Uploaded visuals — first is the hero, the rest form a gallery. */
  images: CampaignImage[];
  /** Social proof / credibility copy. */
  socialProof: string;
  /** Primary call-to-action button label, e.g. "Request a Quotation". */
  ctaLabel: string;
  /** Where the CTA points, e.g. the website or a contact page. */
  ctaUrl: string;
  /** Contact info block (website + sales/contact channels). */
  contactInfo: string;
  /** Footer — company name, slogan, business info. */
  footer: string;
  /** Unsubscribe / manage-preferences line. */
  unsubscribeText: string;
}

/** Default CTA target: the public RFQ intake page (clients upload their RFQ). */
const rfqBaseUrl = () => `${config.appUrl.replace(/\/+$/, "")}${RFQ_PATH}`;

const DEFAULT_CONTACT = [
  `Website: ${COMPANY.website}`,
  `Email: ${COMPANY.email}`,
  `Landline: ${COMPANY.landline}`,
  `Mobile: ${COMPANY.mobile}`,
].join("\n");

const DEFAULT_FOOTER = [COMPANY.name, COMPANY.tagline, COMPANY.manilaOffice, COMPANY.plantAddress].join("\n");

/** Sensible starting draft — pre-filled from the request's examples + COMPANY. */
export function defaultCampaignDraft(): CampaignDraft {
  return {
    senderName: "Aerovent Fans and Blowers Manufacturing",
    subject: "Is Excessive Heat Affecting Your Production Area?",
    preheader: "Discover an airflow solution designed around your facility's requirements.",
    greeting: "Dear {firstName},",
    hook: "Poor airflow and excessive heat can affect employee comfort, equipment performance, and overall productivity.",
    valueProp:
      "At Aerovent, we design customized ventilation solutions around your facility's needs — industrial fans and blowers, airflow engineering, professional installation, and ongoing technical support — so your space stays cooler, safer, and more productive.",
    products: [
      { name: "Industrial Fans & Blowers", blurb: "Centrifugal and axial units built to move the air volume your facility actually needs." },
      { name: "Ventilation & Ductwork", blurb: "Engineered ducting and exhaust systems that clear heat, fumes, and stale air efficiently." },
    ],
    benefits: [
      "Better airflow throughout your facility",
      "Reduced heat buildup on the production floor",
      "Improved, safer working conditions for your staff",
      "More efficient, reliable ventilation",
    ],
    images: [],
    socialProof:
      "Trusted by manufacturers, warehouses, and commercial facilities across the Philippines — backed by years of airflow engineering, in-house testing, and completed installations.",
    ctaLabel: "Request a Quotation",
    ctaUrl: rfqBaseUrl(),
    contactInfo: DEFAULT_CONTACT,
    footer: DEFAULT_FOOTER,
    unsubscribeText:
      "You're receiving this because you're a valued Aerovent contact. If you'd prefer not to receive these emails, you can unsubscribe at any time.",
  };
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const trimOr = (v: unknown, fallback: string): string => {
  const s = str(v).trim();
  return s || fallback;
};

function normalizeProducts(v: unknown): CampaignProduct[] {
  if (!Array.isArray(v)) return [];
  const out: CampaignProduct[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const name = str(o.name).trim();
    const blurb = str(o.blurb).trim();
    const imagePath = str(o.imagePath).trim();
    if (!name && !blurb && !imagePath) continue;
    out.push({
      name,
      blurb,
      ...(imagePath ? { imagePath, imageName: str(o.imageName).trim() || imagePath.split("/").pop() || "image" } : {}),
    });
  }
  return out;
}

function normalizeImages(v: unknown): CampaignImage[] {
  if (!Array.isArray(v)) return [];
  const out: CampaignImage[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const path = str(o.path).trim();
    if (!path) continue;
    out.push({ path, name: str(o.name).trim() || path.split("/").pop() || "image", ...(str(o.caption).trim() ? { caption: str(o.caption).trim() } : {}) });
  }
  return out;
}

function normalizeBenefits(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x).trim()).filter(Boolean);
}

/** Coerce stored/incoming JSON into a complete draft, filling blanks with defaults. */
export function normalizeCampaignDraft(input: Partial<CampaignDraft> | null | undefined): CampaignDraft {
  const d = defaultCampaignDraft();
  if (!input || typeof input !== "object") return d;
  return {
    senderName: trimOr(input.senderName, d.senderName),
    subject: trimOr(input.subject, d.subject),
    // These may legitimately be blank (the section is then dropped) — keep as typed.
    preheader: str(input.preheader).trim(),
    greeting: str(input.greeting, d.greeting),
    hook: str(input.hook),
    valueProp: str(input.valueProp),
    products: Array.isArray(input.products) ? normalizeProducts(input.products) : d.products,
    benefits: Array.isArray(input.benefits) ? normalizeBenefits(input.benefits) : d.benefits,
    images: normalizeImages(input.images),
    socialProof: str(input.socialProof),
    ctaLabel: str(input.ctaLabel).trim(),
    ctaUrl: str(input.ctaUrl).trim(),
    contactInfo: str(input.contactInfo),
    footer: trimOr(input.footer, d.footer),
    unsubscribeText: str(input.unsubscribeText, d.unsubscribeText),
  };
}

export async function getCampaignDraft(): Promise<CampaignDraft> {
  const row = await prisma.appSetting.findUnique({ where: { key: MARKETING_CAMPAIGN_KEY } });
  return normalizeCampaignDraft(row?.value as Partial<CampaignDraft> | null);
}

export async function setCampaignDraft(input: Partial<CampaignDraft>): Promise<CampaignDraft> {
  const d = normalizeCampaignDraft(input);
  await prisma.appSetting.upsert({
    where: { key: MARKETING_CAMPAIGN_KEY },
    create: { key: MARKETING_CAMPAIGN_KEY, value: d as unknown as Prisma.InputJsonValue },
    update: { value: d as unknown as Prisma.InputJsonValue },
  });
  return d;
}

/** Every stored image path referenced by a draft (hero/gallery + product tiles). */
export function campaignImagePaths(d: CampaignDraft): string[] {
  const paths = new Set<string>();
  for (const im of d.images) paths.add(im.path);
  for (const p of d.products) if (p.imagePath) paths.add(p.imagePath);
  return [...paths];
}

// ---- Personalization tokens ----------------------------------------------

export interface CampaignTokens {
  firstName: string;
  contactName: string;
  company: string;
}

/** The tokens offered in the UI (label + the canonical {curly} form to insert). */
export const CAMPAIGN_TOKENS: { key: keyof CampaignTokens; label: string; token: string }[] = [
  { key: "firstName", label: "First name", token: "{firstName}" },
  { key: "contactName", label: "Contact name", token: "{contactName}" },
  { key: "company", label: "Company name", token: "{company}" },
];

// Human-friendly bracket aliases (as the owner wrote them) → canonical key.
const BRACKET_ALIASES: { re: RegExp; key: keyof CampaignTokens }[] = [
  { re: /\[\s*first\s*name\s*\]/gi, key: "firstName" },
  { re: /\[\s*contact\s*name\s*\]/gi, key: "contactName" },
  { re: /\[\s*company(?:\s*name)?\s*\]/gi, key: "company" },
];

/** Replace {token} and [Bracket] placeholders with the recipient's values. */
export function applyCampaignTokens(s: string, tokens: CampaignTokens): string {
  let out = s;
  for (const a of BRACKET_ALIASES) out = out.replace(a.re, tokens[a.key] ?? "");
  return out.replace(/\{(\w+)\}/g, (_, k: string) => (k in tokens ? (tokens[k as keyof CampaignTokens] ?? "") : `{${k}}`));
}

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

// ---- Email assembly -------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Escape then turn single newlines into <br> (paragraphs are split on blanks).
const escLines = (s: string) => esc(s).replace(/\n/g, "<br>");

const paras = (s: string) => s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

export interface CampaignRenderCtx {
  recipient: { company: string; contactName: string | null };
  /** Stored image path → a URL the email client can load (public/long-lived). */
  imageUrls: Record<string, string>;
  /** Per-recipient one-click unsubscribe URL, if available. */
  unsubscribeUrl?: string;
  /** Open/click tracking for this recipient's copy (omit for preview/test). */
  tracking?: { base: string; sendId: string; customerId: string };
  /**
   * Per-recipient RFQ prefill token. Applied ONLY when the CTA points at our /rfq
   * intake page — appends ?c/&t so the form pre-fills this client's details. Never
   * added to any other CTA URL (so the id/token can't leak to external links).
   */
  rfqPrefill?: { customerId: string; token: string };
}

/** Wrap a link so a click is recorded before redirecting to the real target. */
function trackedLink(url: string, t: CampaignRenderCtx["tracking"]): string {
  if (!t) return url;
  return `${t.base}/api/marketing-track?s=${encodeURIComponent(t.sendId)}&c=${encodeURIComponent(t.customerId)}&e=click&u=${encodeURIComponent(url)}`;
}

/**
 * Assemble the campaign into a responsive, email-client-safe HTML email (plus a
 * plain-text alternative). Pure — image URLs and the unsubscribe URL are resolved
 * by the caller and passed in via {@link CampaignRenderCtx}.
 */
export function buildCampaignEmail(draft: CampaignDraft, ctx: CampaignRenderCtx): BuiltEmail {
  const tokens: CampaignTokens = {
    firstName: firstNameOf(ctx.recipient.contactName) || ctx.recipient.company,
    contactName: (ctx.recipient.contactName ?? "").trim() || ctx.recipient.company,
    company: ctx.recipient.company,
  };
  const T = (s: string) => applyCampaignTokens(s, tokens);

  const subject = T(draft.subject).trim() || "A message from Aerovent";
  const preheader = T(draft.preheader).trim();
  const greeting = T(draft.greeting).trim();
  const hook = T(draft.hook).trim();
  const valueProp = T(draft.valueProp).trim();
  const socialProof = T(draft.socialProof).trim();
  const contactInfo = draft.contactInfo.trim();
  const footer = draft.footer.trim();
  const unsub = draft.unsubscribeText.trim();
  const benefits = draft.benefits.map((b) => T(b).trim()).filter(Boolean);
  const products = draft.products.map((p) => ({ ...p, name: T(p.name).trim(), blurb: T(p.blurb).trim() }));
  const heroUrl = draft.images[0] ? ctx.imageUrls[draft.images[0].path] : undefined;
  const galleryImgs = draft.images.slice(1).map((im) => ({ ...im, url: ctx.imageUrls[im.path] })).filter((im) => im.url);

  // ---------------- Plain-text alternative ----------------
  const textParts: string[] = [];
  if (greeting) textParts.push(greeting, "");
  if (hook) textParts.push(...paras(hook).flatMap((p) => [p, ""]));
  if (valueProp) textParts.push(...paras(valueProp).flatMap((p) => [p, ""]));
  if (products.length) {
    textParts.push("What we can help with:");
    for (const p of products) textParts.push(`• ${p.name}${p.blurb ? ` — ${p.blurb}` : ""}`);
    textParts.push("");
  }
  if (benefits.length) {
    textParts.push("What this means for you:");
    for (const b of benefits) textParts.push(`• ${b}`);
    textParts.push("");
  }
  if (socialProof) textParts.push(...paras(socialProof).flatMap((p) => [p, ""]));
  if (draft.ctaLabel.trim() && draft.ctaUrl.trim()) textParts.push(`${draft.ctaLabel.trim()}: ${appendRfqPrefill(draft.ctaUrl.trim(), ctx.rfqPrefill)}`, "");
  if (contactInfo) textParts.push(contactInfo, "");
  if (footer) textParts.push("—", footer);
  if (unsub) {
    textParts.push("", unsub);
    if (ctx.unsubscribeUrl) textParts.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);
  }
  const text = textParts.join("\n");

  // ---------------- HTML ----------------
  const brand = "#0b5c8f";
  const ink = "#1f2933";
  const muted = "#607080";
  const line = "#e2e8f0";

  const sections: string[] = [];

  if (heroUrl) {
    sections.push(
      `<tr><td style="padding:0"><img src="${esc(heroUrl)}" alt="${esc(draft.images[0].name)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`,
    );
  }

  const body: string[] = [];
  if (greeting) body.push(`<p style="margin:0 0 14px">${escLines(greeting)}</p>`);
  for (const p of paras(hook)) body.push(`<p style="margin:0 0 14px;font-size:16px;font-weight:600;color:${ink}">${escLines(p)}</p>`);
  for (const p of paras(valueProp)) body.push(`<p style="margin:0 0 14px">${escLines(p)}</p>`);

  if (products.length) {
    const cards = products
      .map((p) => {
        const img = p.imagePath ? ctx.imageUrls[p.imagePath] : undefined;
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid ${line};border-radius:8px"><tr>${
          img ? `<td width="112" valign="top" style="padding:12px"><img src="${esc(img)}" alt="${esc(p.name)}" width="88" style="display:block;width:88px;height:auto;border-radius:6px;border:0"></td>` : ""
        }<td valign="top" style="padding:12px">${p.name ? `<div style="font-weight:700;color:${ink};margin-bottom:4px">${esc(p.name)}</div>` : ""}${p.blurb ? `<div style="color:${muted};font-size:13px">${escLines(p.blurb)}</div>` : ""}</td></tr></table>`;
      })
      .join("");
    body.push(cards);
  }

  if (benefits.length) {
    body.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;background:#f2f8fc;border-radius:8px"><tr><td style="padding:14px 16px">` +
        `<div style="font-weight:700;color:${brand};margin-bottom:8px">What this means for you</div>` +
        benefits.map((b) => `<div style="margin:0 0 6px;padding-left:20px;position:relative"><span style="position:absolute;left:0;color:${brand}">✓</span>${escLines(b)}</div>`).join("") +
        `</td></tr></table>`,
    );
  }

  for (const im of galleryImgs) {
    body.push(
      `<img src="${esc(im.url!)}" alt="${esc(im.name)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border-radius:8px;border:0;margin:0 0 6px">` +
        (im.caption ? `<div style="color:${muted};font-size:12px;margin:0 0 14px;text-align:center">${esc(im.caption)}</div>` : `<div style="margin-bottom:14px"></div>`),
    );
  }

  for (const p of paras(socialProof)) body.push(`<p style="margin:0 0 14px;color:${muted};font-style:italic">${escLines(p)}</p>`);

  if (draft.ctaLabel.trim() && draft.ctaUrl.trim()) {
    const href = trackedLink(appendRfqPrefill(draft.ctaUrl.trim(), ctx.rfqPrefill), ctx.tracking);
    body.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:6px;background:${brand}"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 26px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">${esc(draft.ctaLabel.trim())}</a></td></tr></table>`,
    );
  }

  if (contactInfo) {
    body.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-top:1px solid ${line}"><tr><td style="padding:14px 0 0;font-size:13px;color:${muted}">${escLines(contactInfo)}</td></tr></table>`,
    );
  }

  sections.push(`<tr><td style="padding:24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${ink}">${body.join("\n")}</td></tr>`);

  // Footer
  const footerBits: string[] = [];
  if (footer) footerBits.push(`<div style="color:#cbd5e1">${escLines(footer)}</div>`);
  if (unsub) {
    footerBits.push(
      `<div style="margin-top:10px;color:#94a3b8">${escLines(unsub)}${
        ctx.unsubscribeUrl ? ` <a href="${esc(ctx.unsubscribeUrl)}" target="_blank" style="color:#cbd5e1;text-decoration:underline">Unsubscribe</a>.` : ""
      }</div>`,
    );
  }
  if (footerBits.length) {
    sections.push(
      `<tr><td style="padding:18px 32px;background:#0f172a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6">${footerBits.join("")}</td></tr>`,
    );
  }

  const preheaderSpan = preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${esc(preheader)}</span>`
    : "";

  const openPixel = ctx.tracking
    ? `<img src="${esc(`${ctx.tracking.base}/api/marketing-track?s=${encodeURIComponent(ctx.tracking.sendId)}&c=${encodeURIComponent(ctx.tracking.customerId)}&e=open`)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#eef2f6">${preheaderSpan}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="padding:18px 32px;background:${brand};font-family:Arial,Helvetica,sans-serif"><div style="color:#ffffff;font-size:17px;font-weight:700">${esc(draft.senderName.trim() || COMPANY.name)}</div><div style="color:#cfe4f2;font-size:11px;letter-spacing:.4px;text-transform:uppercase;margin-top:2px">${esc(COMPANY.tagline)}</div></td></tr>
${sections.join("\n")}
</table>
</td></tr></table>
${openPixel}</body></html>`;

  return { subject, text, html };
}
