import { prisma } from "@/lib/db";
import { getMotorPrices } from "@/lib/motor-prices";
import { SelectionTool } from "./selection-tool";

export const dynamic = "force-dynamic";

export default async function SelectionPage() {
  const [items, motorPrices] = await Promise.all([
    prisma.catalogueItem.findMany({
      where: { active: true },
      select: { id: true, priceList: { where: { variantKey: "default" }, take: 1, select: { basePrice: true } } },
    }),
    getMotorPrices(),
  ]);
  const priceMap = Object.fromEntries(
    items.map((i) => [i.id, i.priceList[0] ? Number(i.priceList[0].basePrice) : 0]),
  );

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Enter a duty point to find matching fans — ranked by performance, with estimated price.
      </p>
      <SelectionTool priceMap={priceMap} motorPrices={motorPrices} />
    </div>
  );
}
