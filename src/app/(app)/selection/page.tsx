import { prisma } from "@/lib/db";
import { SelectionTool } from "./selection-tool";

export const dynamic = "force-dynamic";

export default async function SelectionPage() {
  const items = await prisma.catalogueItem.findMany({
    where: { active: true },
    select: { id: true, priceList: { where: { variantKey: "default" }, take: 1, select: { basePrice: true } } },
  });
  const priceMap = Object.fromEntries(
    items.map((i) => [i.id, i.priceList[0] ? Number(i.priceList[0].basePrice) : 0]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fan Selector</h1>
        <p className="text-muted-foreground">
          Enter a duty point to find matching fans — ranked by performance, with estimated price.
        </p>
      </div>
      <SelectionTool priceMap={priceMap} />
    </div>
  );
}
