import { NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { buildWebsitePriceList, websitePriceListCsv } from "@/lib/website-price-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download the website price list as CSV: every active catalogue item except
 * fabricated fans & blowers, with the AeroQuote price and the website price
 * (= round(AeroQuote ÷ 0.95), covering the 5% online processing fee). Admin only.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const rows = await buildWebsitePriceList();
  const csv = websitePriceListCsv(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aerovent-website-price-list.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
