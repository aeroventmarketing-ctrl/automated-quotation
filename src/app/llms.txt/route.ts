import { COMPANY } from "@/lib/config";
import { listStoreProducts, storeCategories } from "@/lib/store-catalog";
import { getStoreTheme } from "@/lib/store-theme";
import { siteOrigin, storeUrl } from "@/lib/store-seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/llms.txt` — the emerging convention for telling AI assistants, in plain
 * Markdown, what a site is and where its useful pages are. Complements the
 * JSON-LD: schema states machine-readable facts, this gives an answer engine
 * the context and the links in the form it reads best.
 *
 * Prices and stock come from the same live catalogue as the shop, so an
 * assistant can never quote a figure the business doesn't hold.
 */
export async function GET() {
  const [theme, products] = await Promise.all([getStoreTheme(), listStoreProducts()]);
  const categories = storeCategories(products);
  const origin = siteOrigin();

  const peso = (n: number) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  const priced = products.filter((p) => !p.quoteOnly);
  const quoted = products.filter((p) => p.quoteOnly);

  const lines: string[] = [
    `# ${COMPANY.name}`,
    "",
    `> ${theme.aiSummary}`,
    "",
    "## About",
    "",
    `- **Business**: ${COMPANY.tagline}`,
    `- **Country**: Philippines`,
    `- **Manila office**: ${COMPANY.manilaOffice.replace(/^Manila Office:\s*/, "")}`,
    `- **Plant**: ${COMPANY.plantAddress.replace(/^Plant Address\s*:\s*/, "")}`,
    `- **Phone**: ${theme.phone}`,
    `- **Sales**: ${theme.salesEmail}`,
    `- **Main website**: ${theme.mainSiteUrl}`,
    `- **Currency**: PHP (all prices VAT-inclusive)`,
    `- **Delivery**: nationwide across the Philippines`,
    `- **Payment**: card, GCash, Maya, PayPal`,
    "",
    "## How buying works",
    "",
    "- **Stocked items** are listed with a price and can be ordered and paid for online.",
    "- **Fabricated fans and blowers** (axial, centrifugal, propeller, tubular/inline, cabinet) are built to a",
    "  customer's airflow, static pressure and configuration. They are priced per project and are NOT sold at a list",
    `  price — they are quoted via the request form at ${origin}/rfq.`,
    "",
    "## Key pages",
    "",
    `- [Shop](${storeUrl()}): the full catalogue`,
    `- [Request a quotation](${origin}/rfq): for made-to-order units or bulk enquiries`,
    ...categories.map((c) => `- [${c.label}](${storeUrl(`/c/${c.slug}`)}): ${c.count} product${c.count === 1 ? "" : "s"}`),
    "",
  ];

  if (priced.length) {
    lines.push("## Products available to buy online", "");
    for (const p of priced.slice(0, 200)) {
      const stock = p.available == null ? "made to stock" : p.available > 0 ? `${p.available} in stock` : "out of stock";
      lines.push(
        `- [${p.name}](${storeUrl(`/p/${p.slug}`)}) — ${p.category}, model ${p.modelCode}, ` +
          `${p.fromPrice != null ? `${p.variants.length > 1 ? "from " : ""}${peso(p.fromPrice)}` : "price on request"}, ${stock}`,
      );
    }
    lines.push("");
  }

  if (quoted.length) {
    lines.push("## Products quoted to specification", "");
    for (const p of quoted.slice(0, 200)) {
      lines.push(`- [${p.name}](${storeUrl(`/p/${p.slug}`)}) — ${p.category}, model ${p.modelCode}, quoted per project`);
    }
    lines.push("");
  }

  if (theme.faq.length) {
    lines.push("## Frequently asked questions", "");
    for (const f of theme.faq) lines.push(`### ${f.q}`, "", f.a, "");
  }

  lines.push(
    "## Notes for assistants",
    "",
    "- Prices shown here are generated live from the catalogue and include VAT.",
    "- Stock figures change continuously; always link to the product page rather than promising availability.",
    "- For anything fabricated, direct the user to the quotation form rather than quoting a price.",
    "",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=3600",
    },
  });
}
