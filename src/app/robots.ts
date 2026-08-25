import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/store-seo";

/**
 * Open the storefront to crawlers (including AI answer engines — they're how
 * buyers increasingly find suppliers) while keeping the signed-in ERP, the API
 * surface and shared quote links out of every index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/store", "/rfq", "/llms.txt"],
        disallow: [
          "/api/", "/admin/", "/orders/", "/quotations/", "/inquiries/", "/purchasing/",
          "/inventory/", "/products/", "/counter-sales/", "/requisitions/", "/cash-requests/",
          "/commissions/", "/management/", "/marketing/", "/my-dashboard", "/dashboard",
          "/store/cart", "/store/checkout", "/store/order/", "/q/", "/login", "/account",
        ],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  };
}
