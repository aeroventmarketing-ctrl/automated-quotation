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
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STORE_THEME_KEY = "store_theme";

export interface StoreFeature {
  /** Lucide-ish icon key — see ICON_KEYS in the editor. */
  icon: string;
  title: string;
  body: string;
}

export interface StoreTheme {
  // --- Look -------------------------------------------------------------
  /** Primary brand colour (hex). Buttons, links, accents. */
  accent: string;
  /** Darker shade for hover states (hex). */
  accentDark: string;
  /** Deep neutral used for the hero / footer ground (hex). */
  ink: string;
  /** Corner rounding for cards & buttons. */
  radius: "sharp" | "soft" | "round";
  /** Product image framing — "contain" suits cut-out product shots. */
  imageFit: "contain" | "cover";

  // --- Content ----------------------------------------------------------
  /** Thin bar above the header. Empty hides it. */
  announcement: string;
  heroHeadline: string;
  heroSubhead: string;
  heroCtaLabel: string;
  heroCtaHref: string;
  /** Optional hero background image (a `store/…` storage path). */
  heroImagePath: string;
  /** Three value props under the hero. */
  features: StoreFeature[];

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
  accent: "#ED1C24",
  accentDark: "#C2141A",
  ink: "#0F172A",
  radius: "soft",
  imageFit: "contain",

  announcement: "Nationwide delivery across the Philippines · Trade enquiries welcome",
  heroHeadline: "Air moving equipment, engineered to move air properly.",
  heroSubhead:
    "Industrial fans, blowers and ventilation components — stocked lines you can order online, and fabricated units built to your specification.",
  heroCtaLabel: "Shop the catalogue",
  heroCtaHref: "#products",
  heroImagePath: "",
  features: [
    { icon: "factory", title: "Manufactured in-house", body: "Fabricated fans and blowers built to your airflow and static pressure, not pulled off a shelf." },
    { icon: "truck", title: "Nationwide delivery", body: "Dispatched from our Laguna plant and Manila office to sites across the Philippines." },
    { icon: "wrench", title: "Engineering support", body: "Talk to people who size fans for a living — selection help before you buy, service after." },
  ],

  seoTitle: "Industrial Fans, Blowers & Ventilation Equipment | Aerovent Philippines",
  seoDescription:
    "Buy industrial fans, blowers and ventilation equipment online in the Philippines. Axial, centrifugal and inline fans, ducting and accessories — stocked lines and made-to-order units from Aerovent Fans & Blowers Manufacturing.",
  seoKeywords:
    "industrial fan Philippines, blower supplier Manila, ventilation equipment, exhaust fan, centrifugal blower, axial fan, inline duct fan, air moving equipment",
  aiSummary:
    "Aerovent Fans & Blowers Manufacturing is a Philippine manufacturer and supplier of industrial ventilation and air-moving equipment. It fabricates axial, centrifugal, propeller, tubular/inline and cabinet fans to specification, and sells stocked fans, ducting and accessories online with nationwide delivery.",
};

/** Corner-radius class for the chosen rounding. */
export const radiusClass = (r: StoreTheme["radius"]): string =>
  r === "sharp" ? "rounded-none" : r === "round" ? "rounded-2xl" : "rounded-lg";

const str = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);
/** Accept only a #rgb / #rrggbb colour — anything else falls back (this value lands in CSS). */
const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : fallback;

function coerceFeatures(v: unknown): StoreFeature[] {
  if (!Array.isArray(v)) return DEFAULT_STORE_THEME.features;
  const out = v
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      icon: str(f.icon, "check"),
      title: str(f.title, ""),
      body: str(f.body, ""),
    }))
    .filter((f) => f.title !== "");
  return out.length ? out.slice(0, 4) : DEFAULT_STORE_THEME.features;
}

/** Fill in every field, so a partial or corrupt row can never break the shop. */
export function normalizeStoreTheme(input: Partial<StoreTheme> | null | undefined): StoreTheme {
  const d = DEFAULT_STORE_THEME;
  const i = (input ?? {}) as Record<string, unknown>;
  const radius = i.radius === "sharp" || i.radius === "round" ? i.radius : d.radius;
  const imageFit = i.imageFit === "cover" ? "cover" : d.imageFit;
  return {
    accent: hex(i.accent, d.accent),
    accentDark: hex(i.accentDark, d.accentDark),
    ink: hex(i.ink, d.ink),
    radius,
    imageFit,
    // An empty announcement is meaningful (hides the bar), so it isn't defaulted.
    announcement: typeof i.announcement === "string" ? i.announcement.trim() : d.announcement,
    heroHeadline: str(i.heroHeadline, d.heroHeadline),
    heroSubhead: str(i.heroSubhead, d.heroSubhead),
    heroCtaLabel: str(i.heroCtaLabel, d.heroCtaLabel),
    heroCtaHref: str(i.heroCtaHref, d.heroCtaHref),
    heroImagePath: typeof i.heroImagePath === "string" ? i.heroImagePath.trim() : "",
    features: coerceFeatures(i.features),
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
