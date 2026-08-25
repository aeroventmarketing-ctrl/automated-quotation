/**
 * Structured data for the storefront — the single biggest lever for both
 * classic SEO (rich results: price, availability, breadcrumbs) and "AI SEO",
 * since assistants and answer engines lean on schema.org JSON-LD to state facts
 * about a product confidently rather than guessing from prose.
 *
 * Everything here is derived from the same catalogue the ERP uses, so the shop
 * can never advertise a price or a stock state that the business doesn't hold.
 */
import { COMPANY, config } from "@/lib/config";
import type { StoreProduct } from "@/lib/store-catalog";
import type { StoreTheme } from "@/lib/store-theme";

/** Absolute site origin, no trailing slash — schema.org wants absolute URLs. */
export const siteOrigin = (): string => config.appUrl.replace(/\/+$/, "");
export const storeUrl = (path = ""): string => `${siteOrigin()}/store${path}`;
/** Absolute URL for a product photo stored in Supabase. */
export const photoUrl = (path: string): string => `${siteOrigin()}/api/store-image?path=${encodeURIComponent(path)}`;

/** Escape a JSON-LD payload for safe inlining inside a <script> tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** The seller — reused as the `brand` / `seller` on every product. */
export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": `${siteOrigin()}/#organization`,
    name: COMPANY.name,
    url: siteOrigin(),
    email: COMPANY.email,
    telephone: "(02) 85619413",
    address: {
      "@type": "PostalAddress",
      streetAddress: "1933-C Augusto Francisco Street, Sta. Ana",
      addressLocality: "Manila",
      addressCountry: "PH",
    },
    areaServed: { "@type": "Country", name: "Philippines" },
  };
}

/** Site-level graph for the shop home: org + site + search action. */
export function storeHomeLd(theme: StoreTheme) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationLd(),
      {
        "@type": "WebSite",
        "@id": `${siteOrigin()}/#website`,
        url: siteOrigin(),
        name: COMPANY.name,
        description: theme.seoDescription,
        publisher: { "@id": `${siteOrigin()}/#organization` },
        // Lets search engines (and assistants) query the catalogue directly.
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${storeUrl()}?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Store",
        name: COMPANY.name,
        url: storeUrl(),
        description: theme.aiSummary,
        currenciesAccepted: "PHP",
        paymentAccepted: "Credit Card, GCash, Maya, PayPal, Bank Transfer",
      },
    ],
  };
}

/** Breadcrumb trail — drives the breadcrumb rich result. */
export function breadcrumbLd(trail: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

/**
 * A single product. Priced items carry a real `Offer` with availability so the
 * price can surface directly in results; a quote-only item deliberately carries
 * **no price** — advertising one we don't honour would be worse than silence.
 */
export function productLd(p: StoreProduct) {
  const url = storeUrl(`/p/${p.slug}`);
  const images = p.photos.map((ph) => photoUrl(ph.path));
  const availability = p.quoteOnly
    ? "https://schema.org/PreOrder"
    : p.available != null && p.available <= 0
      ? "https://schema.org/OutOfStock"
      : "https://schema.org/InStock";

  const base = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: p.name,
    sku: p.modelCode,
    mpn: p.modelCode,
    description: p.description ?? `${p.name} — ${p.category} from ${COMPANY.name}.`,
    category: p.category,
    url,
    ...(images.length ? { image: images } : {}),
    brand: { "@type": "Brand", name: COMPANY.name },
    manufacturer: { "@id": `${siteOrigin()}/#organization` },
  };

  if (p.quoteOnly || p.variants.length === 0) return base;

  const prices = p.variants.map((v) => v.websitePrice);
  const offer =
    p.variants.length === 1
      ? {
          "@type": "Offer",
          url,
          priceCurrency: "PHP",
          price: prices[0].toFixed(2),
          availability,
          itemCondition: "https://schema.org/NewCondition",
          seller: { "@id": `${siteOrigin()}/#organization` },
        }
      : {
          "@type": "AggregateOffer",
          url,
          priceCurrency: "PHP",
          lowPrice: Math.min(...prices).toFixed(2),
          highPrice: Math.max(...prices).toFixed(2),
          offerCount: prices.length,
          availability,
          seller: { "@id": `${siteOrigin()}/#organization` },
        };

  return { ...base, offers: offer };
}

/** A category / listing page as an ItemList, so crawlers see the set at once. */
export function itemListLd(products: StoreProduct[], listUrl: string, name: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: listUrl,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 60).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: storeUrl(`/p/${p.slug}`),
      name: p.name,
    })),
  };
}
