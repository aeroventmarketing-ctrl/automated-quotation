/**
 * The motor prices, read from the catalogue — server side.
 *
 * Kept apart from `motor-catalogue.ts` on purpose: that file is pure and is
 * imported by CLIENT components (the quotation builder, the fan selector, the
 * inquiry workspace) to resolve a price they were handed. This one touches
 * Prisma, so it must never end up in a browser bundle.
 *
 * Every page that prices a motor fetches this and passes it down as a prop. It
 * is one indexed read of a few hundred small rows, memoised for the request, so
 * a page that needs it in two places pays for it once.
 */
import { cache } from "react";
import { prisma } from "@/lib/db";
import type { MotorPriceMap } from "@/lib/motor-catalogue";

/**
 * Model code → price, for every active motor in the catalogue.
 *
 * **Fails soft, and that is deliberate.** An empty map is not an outage: every
 * caller falls back to the code tables it used before this existed, so a
 * database hiccup prices a fan the old way rather than pricing it at zero. A
 * quotation that is quietly wrong is far worse than one that is quietly
 * old-fashioned.
 */
export const getMotorPrices = cache(async function getMotorPrices(): Promise<MotorPriceMap> {
  try {
    const items = await prisma.catalogueItem.findMany({
      where: { family: "MOTOR", active: true },
      select: {
        modelCode: true,
        priceList: { where: { variantKey: "default" }, take: 1, select: { basePrice: true } },
      },
    });
    const map: MotorPriceMap = {};
    for (const it of items) {
      const p = it.priceList[0];
      if (!p) continue;
      const n = Number(p.basePrice);
      // An unpriced or zeroed row is "no opinion", not "free" — leaving it out
      // means the caller falls back instead of quoting a motor at ₱0.
      if (Number.isFinite(n) && n > 0) map[it.modelCode] = n;
    }
    return map;
  } catch (e) {
    console.error("motor prices unavailable — falling back to the code tables", e);
    return {};
  }
});
