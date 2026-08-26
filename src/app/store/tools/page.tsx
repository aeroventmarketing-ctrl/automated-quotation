import type { Metadata } from "next";
import Link from "next/link";
import { getStoreTheme } from "@/lib/store-theme";
import { jsonLd, breadcrumbLd, storeUrl } from "@/lib/store-seo";
import { WRAP, DISPLAY, KICKER } from "@/lib/store-ui";
import { COMPANY } from "@/lib/config";
import { QuoteButton } from "../store-actions";
import { ToolsWorkbench } from "./tools-workbench";
import { toolKeyFrom } from "./tools";

export const dynamic = "force-dynamic";

const TITLE = "HVAC Tools — Fan Selector, Ductulator, Pulley & Fan Law";
const DESCRIPTION =
  "Free HVAC calculators from Aerovent Fans and Blowers Manufacturing: select an industrial fan for your duty point, size ductwork, work out belt-drive pulleys, and apply the fan affinity laws.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: storeUrl("/tools") },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: storeUrl("/tools") },
};

/**
 * Public HVAC Tools page.
 *
 * The four calculators an engineer actually reaches for while specifying a job.
 * The Fan Selector runs the same selection engine as the staff quotation
 * builder through `/api/public/fan-select`, which is performance-only — no
 * price, no cost, no internal id ever crosses to the public side. The other
 * three are pure maths shared with the staff tools via `lib/hvac/*`.
 *
 * Deliberately excluded from the public set: Duct Material (a sheet-metal
 * costing aid) and Job Order (a production document) — both internal.
 */
export default async function StoreToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  const theme = await getStoreTheme();
  const initial = toolKeyFrom(tool);

  const trail = [
    { name: "Shop", url: storeUrl() },
    { name: "HVAC Tools", url: storeUrl("/tools") },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbLd(trail)) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Aerovent HVAC Tools",
            url: storeUrl("/tools"),
            applicationCategory: "EngineeringApplication",
            operatingSystem: "Any (web browser)",
            description: DESCRIPTION,
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "PHP" },
            publisher: { name: COMPANY.name },
            featureList: ["Fan Selector", "Ductulator", "Pulley Calculator", "Fan Law Calculator"],
          }),
        }}
      />

      <div className="bg-[linear-gradient(115deg,#07101f_0%,#101c30_58%,#26111b_100%)] text-[var(--store-on-dark)]">
        <div className={`${WRAP} py-14`}>
          <nav aria-label="Breadcrumb" className="text-[12px] text-[var(--store-on-dark-muted)]">
            <Link href="/store" className="transition-colors hover:text-[var(--store-on-dark)]">Shop</Link>
            <span className="mx-2 text-white/25">/</span>
            <span className="text-white/80">HVAC Tools</span>
          </nav>
          <div className={`${KICKER} mt-4`}>Free engineering tools</div>
          <h1 className={`${DISPLAY} mt-2 text-[clamp(40px,5vw,60px)] leading-none tracking-[-0.02em]`}>HVAC Tools</h1>
          <p className="mt-3 max-w-[640px] text-[15px] leading-[1.7] text-[var(--store-on-dark-muted)]">
            Size a fan, a duct or a drive in the browser. Built on the same selection engine we use to prepare
            quotations — so what you work out here is what our engineers see.
          </p>
        </div>
      </div>

      <ToolsWorkbench initial={initial} />

      <section className="border-t border-[var(--store-line)] bg-white">
        <div className={`${WRAP} flex flex-col items-start gap-6 py-14 lg:flex-row lg:items-center lg:justify-between`}>
          <div className="max-w-2xl">
            <div className={KICKER}>{theme.solutionKicker}</div>
            <h2 className={`${DISPLAY} mt-2 text-[34px] leading-none`}>Want this checked by an engineer?</h2>
            <p className="mt-2.5 text-[14.5px] leading-relaxed text-[var(--store-steel)]">
              These calculators get you to a working number. Send us the airflow, static pressure and site conditions
              and our technical team will confirm the selection, the accessories and the price.
            </p>
          </div>
          <QuoteButton className="shrink-0 rounded-[5px] bg-[var(--store-accent)] px-6 py-4 text-[15px] font-extrabold text-white shadow-[0_12px_32px_rgba(229,32,43,0.28)] transition-colors hover:bg-[var(--store-accent-dark)]">
            {theme.solutionCtaLabel} →
          </QuoteButton>
        </div>
      </section>
    </>
  );
}
