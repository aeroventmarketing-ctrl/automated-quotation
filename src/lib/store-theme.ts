/**
 * Storefront theme & content settings — everything about the shop's *vibe* that
 * an owner should be able to change without a developer.
 *
 * Rides in an `AppSetting` row (the same pattern as the follow-up config), so
 * there's no migration and no deploy needed to restyle the shop: edit it in
 * Admin → Storefront and the next page render picks it up.
 *
 * Colours are emitted as CSS custom properties on the store's root element, so
 * Tailwind classes like `bg-[var(--store-accent)]` follow whatever is set here.
 *
 * The defaults reproduce the approved storefront design: a dark engineering
 * hero, a red accent, condensed uppercase headings and the section copy that
 * came with it. Everything below is editable, so the shop can be re-pitched
 * without a deploy.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STORE_THEME_KEY = "store_theme";

export interface StoreFeature {
  /** Icon key — see ICON_KEYS in the editor. */
  icon: string;
  title: string;
  body: string;
}

/** A header / footer navigation entry. */
export interface StoreLink {
  label: string;
  href: string;
}

/** One of the hero's proof figures ("30+ Years" / "Manufacturing experience"). */
export interface StoreMetric {
  value: string;
  label: string;
}

/** One accordion entry in the article section (also emitted as FAQ structured data). */
export interface StoreFaq {
  q: string;
  a: string;
}

export interface StoreTheme {
  // --- Look -------------------------------------------------------------
  /** Primary brand colour (hex). Buttons, links, accents. */
  accent: string;
  /** Darker shade for hover states and gradients (hex). */
  accentDark: string;
  /** Deep neutral used for the hero / footer ground (hex). */
  ink: string;
  /** A step lighter than `ink` — category tiles and the solutions panel (hex). */
  ink2: string;
  /** Page ground behind the sections (hex). */
  paper: string;
  /**
   * Text colours, one per surface-and-emphasis pair. The storefront alternates
   * between light sections and dark ones (hero, footer, category tiles), and
   * each carries a full-strength colour for headings and body plus a quieter
   * one for captions, breadcrumbs and supporting copy.
   *
   * Button labels are deliberately NOT these: they sit on the accent or on
   * `ink`, so they follow the button, not the page.
   */
  /** Headings and body on light sections (hex). */
  text: string;
  /** Captions and supporting copy on light sections (hex). */
  textMuted: string;
  /** Headings and body on the dark sections (hex). */
  textOnDark: string;
  /** Captions and supporting copy on the dark sections (hex). */
  textMutedOnDark: string;
  /** Corner rounding for cards & buttons. */
  radius: "sharp" | "soft" | "round";
  /** Product image framing — "contain" suits cut-out product shots. */
  imageFit: "contain" | "cover";

  // --- Top bar ----------------------------------------------------------
  /** Bold text in the thin bar above the header. Empty hides the whole bar. */
  announcement: string;
  /** The lighter clause after the announcement. */
  announcementNote: string;
  /** Short notes shown at the right of the top bar (hidden on small screens). */
  topLinks: string[];

  // --- Header -----------------------------------------------------------
  /** Logo image — a public path ("/aerovent-logo.jpg"), a `store/…` upload, or a URL. */
  logoUrl: string;
  /** Main navigation. External links (http…) open in a new tab. */
  navLinks: StoreLink[];
  /**
   * Label for the public HVAC Tools page, shown in the nav just before the
   * first external link. Empty hides it. It's a field of its own rather than a
   * `navLinks` entry so it appears for shops whose theme was saved before the
   * tools page existed — a stored `navLinks` array would not have contained it.
   */
  toolsNavLabel: string;

  // --- Hero -------------------------------------------------------------
  heroEyebrow: string;
  heroHeadline: string;
  /** Second headline line, shown in the accent colour. Empty for a one-line headline. */
  heroHeadlineAccent: string;
  heroSubhead: string;
  heroCtaLabel: string;
  heroCtaHref: string;
  /** Secondary hero button — always opens the quotation dialog. Empty hides it. */
  heroCta2Label: string;
  /** Optional hero product photo (a `store/…` storage path) shown in the stage. */
  heroImagePath: string;
  /** Proof figures under the hero copy. */
  metrics: StoreMetric[];

  // --- Trust band -------------------------------------------------------
  /** The value props in the band under the hero (up to four). */
  features: StoreFeature[];

  // --- Sections ---------------------------------------------------------
  categoriesKicker: string;
  categoriesTitle: string;
  categoriesBlurb: string;
  catalogueKicker: string;
  catalogueTitle: string;
  catalogueBlurb: string;

  solutionKicker: string;
  solutionTitle: string;
  solutionBody: string;
  solutionBullets: string[];
  solutionCtaLabel: string;

  articleKicker: string;
  articleTitle: string;
  /** Blank-line-separated paragraphs. */
  articleBody: string;
  faq: StoreFaq[];

  // --- Contact ----------------------------------------------------------
  phone: string;
  salesEmail: string;
  mainSiteUrl: string;
  facebookUrl: string;

  // --- SEO --------------------------------------------------------------
  /** <title> for the shop home. Other pages derive from it. */
  seoTitle: string;
  seoDescription: string;
  /** Comma-separated focus keywords, woven into the home page copy/meta. */
  seoKeywords: string;
  /** Short description used in llms.txt and AI answer summaries. */
  aiSummary: string;
}

export const DEFAULT_STORE_THEME: StoreTheme = {
  accent: "#E5202B",
  accentDark: "#B80F1A",
  ink: "#0B1424",
  ink2: "#111D31",
  paper: "#F5F7F9",
  // The approved design's own values: `text` matches `ink`, and the two muted
  // shades are the ones its light and dark sections already used.
  text: "#0B1424",
  textMuted: "#607084",
  textOnDark: "#FFFFFF",
  textMutedOnDark: "#B9C4D2",
  radius: "soft",
  imageFit: "cover",

  announcement: "ENGINEERING SUPERIOR AIRFLOW SOLUTIONS",
  announcementNote: "Philippine manufacturer since 1994",
  topLinks: ["Nationwide delivery", "Sales: (02) 8561 9413"],

  logoUrl: "/aerovent-logo.jpg",
  navLinks: [
    { label: "Shop", href: "/store#products" },
    { label: "Categories", href: "/store#categories" },
    { label: "Custom Solutions", href: "/store#custom" },
    { label: "Why Aerovent", href: "/store#about" },
    { label: "Main Website ↗", href: "https://www.aeroventfbm.com/" },
  ],
  toolsNavLabel: "HVAC Tools",

  heroEyebrow: "Industrial ventilation equipment Philippines",
  heroHeadline: "Engineered airflow.",
  heroHeadlineAccent: "Built for industry.",
  heroSubhead:
    "Shop dependable industrial fans, centrifugal blowers and ventilation equipment from Aerovent Fans and Blowers Manufacturing — engineered for factories, warehouses and commercial facilities across the Philippines.",
  heroCtaLabel: "Explore products",
  heroCtaHref: "#products",
  heroCta2Label: "Request engineered quotation",
  heroImagePath: "",
  metrics: [
    { value: "30+ Years", label: "Manufacturing experience" },
    { value: "Nationwide", label: "Philippine delivery" },
    { value: "Tested", label: "Quality & balancing" },
  ],

  features: [
    { icon: "factory", title: "Manufactured in-house", body: "Purpose-built airflow equipment" },
    { icon: "check", title: "Quality tested", body: "Airflow, voltage and current checks" },
    { icon: "wrench", title: "Engineering support", body: "Selection based on your application" },
    { icon: "truck", title: "Nationwide delivery", body: "Serving clients across the Philippines" },
  ],

  categoriesKicker: "Find your airflow solution",
  categoriesTitle: "Shop by category",
  categoriesBlurb:
    "Browse stocked equipment or request a made-to-order industrial ventilation solution based on airflow, static pressure and site conditions.",
  catalogueKicker: "Industrial-grade equipment",
  catalogueTitle: "Featured catalogue",
  catalogueBlurb:
    "Prices shown are VAT-inclusive. Product availability, technical suitability and delivery schedule are confirmed before order processing.",

  solutionKicker: "Made-to-order systems",
  solutionTitle: "Not sure which fan or blower you need?",
  solutionBody:
    "Send your airflow requirement, static pressure, application and site information. Our technical team can help select or customize an industrial ventilation solution for your facility.",
  solutionBullets: [
    "Factories and production areas",
    "Warehouses and storage",
    "Commercial kitchens",
    "Process exhaust systems",
  ],
  solutionCtaLabel: "Start a technical enquiry",

  articleKicker: "Industrial ventilation expertise",
  articleTitle: "Industrial fans and blowers engineered in the Philippines",
  articleBody:
    "Aerovent Fans and Blowers Manufacturing supplies and fabricates industrial air-moving equipment for Philippine factories, warehouses, commercial buildings and process applications. Our catalogue includes axial fans, centrifugal blowers, tubeaxial fans, wall fans, inline duct fans and related ventilation equipment.\n\nFor applications that cannot be served by a standard unit, we develop customized airflow solutions based on the required volume, static pressure, operating environment and installation conditions.",
  faq: [
    {
      q: "How do I choose the correct industrial fan?",
      a: "Selection should consider airflow, static pressure, air temperature, contaminants, operating hours and installation conditions. Submit these details for technical evaluation.",
    },
    {
      q: "Can Aerovent manufacture custom blowers?",
      a: "Yes. Made-to-order fans and blowers can be designed around the required performance and application, subject to engineering review.",
    },
    {
      q: "Do you deliver outside Metro Manila?",
      a: "Yes. Aerovent serves customers throughout the Philippines. Delivery cost and schedule depend on the item, quantity and destination.",
    },
  ],

  phone: "(02) 8561 9413",
  salesEmail: "sales@aeroventfbm.com",
  mainSiteUrl: "https://www.aeroventfbm.com/",
  facebookUrl: "https://facebook.com/aeroventfbm",

  seoTitle: "Industrial Fans & Blowers Philippines | Aerovent Online Shop",
  seoDescription:
    "Shop industrial fans, centrifugal blowers, axial fans and ventilation equipment from Aerovent Fans and Blowers Manufacturing. Nationwide delivery and engineered-to-order airflow solutions in the Philippines.",
  seoKeywords:
    "industrial fans Philippines, industrial blower Philippines, centrifugal blower, axial fan, ventilation equipment, factory ventilation, warehouse ventilation",
  aiSummary:
    "Aerovent Fans and Blowers Manufacturing is a Philippine manufacturer and supplier of industrial ventilation and air-moving equipment. It fabricates axial, centrifugal, propeller, tubular/inline and cabinet fans to specification, and sells stocked fans, ducting and accessories online with nationwide delivery.",
};

/**
 * Corner-radius class for the chosen rounding. "soft" is the approved design's
 * 6px — tight enough to stay technical rather than friendly.
 */
export const radiusClass = (r: StoreTheme["radius"]): string =>
  r === "sharp" ? "rounded-none" : r === "round" ? "rounded-2xl" : "rounded-md";

const str = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);
/** A field where empty is a real choice (hides the element) rather than "unset". */
const optional = (v: unknown, fallback: string): string => (typeof v === "string" ? v.trim() : fallback);
/** Accept only a #rgb / #rrggbb colour — anything else falls back (this value lands in CSS). */
const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : fallback;

/** Coerce a list of short strings, keeping the fallback when nothing usable survives. */
function coerceStrings(v: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean);
  return out.length ? out.slice(0, max) : fallback;
}

/** Generic coercion for a list of records with required text fields. */
function coerceList<T>(v: unknown, fallback: T[], max: number, map: (r: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return fallback;
  const out = v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map(map)
    .filter((r): r is T => r !== null);
  return out.length ? out.slice(0, max) : fallback;
}

/**
 * A navigation href we're willing to put in the page. Same-origin paths and
 * fragments are fine; absolute URLs must be http(s) — this keeps a corrupt or
 * hand-edited setting from injecting a `javascript:` link into the storefront.
 */
export function safeHref(raw: unknown, fallback = "/store"): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return fallback;
  if (v.startsWith("/") || v.startsWith("#")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^mailto:|^tel:/i.test(v)) return v;
  return fallback;
}

/** Resolve a logo/image setting to something an <img src> can use. */
export function themeImageSrc(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("store/")) return `/api/store-image?path=${encodeURIComponent(v)}`;
  if (v.startsWith("/") || /^https?:\/\//i.test(v)) return v;
  return "";
}

function coerceFeatures(v: unknown): StoreFeature[] {
  return coerceList<StoreFeature>(v, DEFAULT_STORE_THEME.features, 4, (f) => {
    const title = str(f.title, "");
    return title ? { icon: str(f.icon, "check"), title, body: optional(f.body, "") } : null;
  });
}

/** Fill in every field, so a partial or corrupt row can never break the shop. */
export function normalizeStoreTheme(input: Partial<StoreTheme> | null | undefined): StoreTheme {
  const d = DEFAULT_STORE_THEME;
  const i = (input ?? {}) as Record<string, unknown>;
  const radius = i.radius === "sharp" || i.radius === "round" ? i.radius : d.radius;
  const imageFit = i.imageFit === "contain" ? "contain" : d.imageFit;
  return {
    accent: hex(i.accent, d.accent),
    accentDark: hex(i.accentDark, d.accentDark),
    ink: hex(i.ink, d.ink),
    ink2: hex(i.ink2, d.ink2),
    paper: hex(i.paper, d.paper),
    text: hex(i.text, d.text),
    textMuted: hex(i.textMuted, d.textMuted),
    textOnDark: hex(i.textOnDark, d.textOnDark),
    textMutedOnDark: hex(i.textMutedOnDark, d.textMutedOnDark),
    radius,
    imageFit,

    // An empty announcement is meaningful (hides the bar), so it isn't defaulted.
    announcement: optional(i.announcement, d.announcement),
    announcementNote: optional(i.announcementNote, d.announcementNote),
    topLinks: coerceStrings(i.topLinks, d.topLinks, 3),

    logoUrl: optional(i.logoUrl, d.logoUrl),
    navLinks: coerceList<StoreLink>(i.navLinks, d.navLinks, 6, (l) => {
      const label = str(l.label, "");
      return label ? { label, href: safeHref(l.href) } : null;
    }),
    toolsNavLabel: optional(i.toolsNavLabel, d.toolsNavLabel),

    heroEyebrow: optional(i.heroEyebrow, d.heroEyebrow),
    heroHeadline: str(i.heroHeadline, d.heroHeadline),
    heroHeadlineAccent: optional(i.heroHeadlineAccent, d.heroHeadlineAccent),
    heroSubhead: str(i.heroSubhead, d.heroSubhead),
    heroCtaLabel: str(i.heroCtaLabel, d.heroCtaLabel),
    heroCtaHref: safeHref(i.heroCtaHref, d.heroCtaHref),
    heroCta2Label: optional(i.heroCta2Label, d.heroCta2Label),
    heroImagePath: typeof i.heroImagePath === "string" ? i.heroImagePath.trim() : "",
    metrics: coerceList<StoreMetric>(i.metrics, d.metrics, 4, (m) => {
      const value = str(m.value, "");
      return value ? { value, label: optional(m.label, "") } : null;
    }),

    features: coerceFeatures(i.features),

    categoriesKicker: optional(i.categoriesKicker, d.categoriesKicker),
    categoriesTitle: str(i.categoriesTitle, d.categoriesTitle),
    categoriesBlurb: optional(i.categoriesBlurb, d.categoriesBlurb),
    catalogueKicker: optional(i.catalogueKicker, d.catalogueKicker),
    catalogueTitle: str(i.catalogueTitle, d.catalogueTitle),
    catalogueBlurb: optional(i.catalogueBlurb, d.catalogueBlurb),

    solutionKicker: optional(i.solutionKicker, d.solutionKicker),
    solutionTitle: str(i.solutionTitle, d.solutionTitle),
    solutionBody: str(i.solutionBody, d.solutionBody),
    solutionBullets: coerceStrings(i.solutionBullets, d.solutionBullets, 8),
    solutionCtaLabel: str(i.solutionCtaLabel, d.solutionCtaLabel),

    articleKicker: optional(i.articleKicker, d.articleKicker),
    articleTitle: str(i.articleTitle, d.articleTitle),
    articleBody: str(i.articleBody, d.articleBody),
    faq: coerceList<StoreFaq>(i.faq, d.faq, 8, (f) => {
      const q = str(f.q, "");
      const a = str(f.a, "");
      return q && a ? { q, a } : null;
    }),

    phone: optional(i.phone, d.phone),
    salesEmail: optional(i.salesEmail, d.salesEmail),
    mainSiteUrl: safeHref(i.mainSiteUrl, d.mainSiteUrl),
    facebookUrl: safeHref(i.facebookUrl, d.facebookUrl),

    seoTitle: str(i.seoTitle, d.seoTitle),
    seoDescription: str(i.seoDescription, d.seoDescription),
    seoKeywords: str(i.seoKeywords, d.seoKeywords),
    aiSummary: str(i.aiSummary, d.aiSummary),
  };
}

/** The live storefront theme (defaults when never configured). */
export async function getStoreTheme(): Promise<StoreTheme> {
  const row = await prisma.appSetting.findUnique({ where: { key: STORE_THEME_KEY } }).catch(() => null);
  return normalizeStoreTheme(row?.value as Partial<StoreTheme> | null);
}

/** Persist the theme, returning the normalized value that was stored. */
export async function setStoreTheme(input: Partial<StoreTheme>): Promise<StoreTheme> {
  const value = normalizeStoreTheme(input);
  await prisma.appSetting.upsert({
    where: { key: STORE_THEME_KEY },
    create: { key: STORE_THEME_KEY, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
  return value;
}
