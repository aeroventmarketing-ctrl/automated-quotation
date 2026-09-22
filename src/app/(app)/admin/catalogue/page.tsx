import { prisma } from "@/lib/db";
import { motorCatalogueRows } from "@/lib/motor-catalogue";
import { CatalogueManager } from "./catalogue-manager";
import { MotorSeedButton } from "./motor-seed-button";

export const dynamic = "force-dynamic";

export default async function AdminCataloguePage() {
  const [items, motorsPresent] = await Promise.all([
    prisma.catalogueItem.findMany({
      orderBy: [{ family: "asc" }, { modelCode: "asc" }],
      include: { priceList: { where: { variantKey: "default" }, take: 1 } },
    }),
    prisma.catalogueItem.count({ where: { family: "MOTOR" } }),
  ]);

  return (
    <CatalogueManager
      items={items.map((i) => ({
        id: i.id,
        modelCode: i.modelCode,
        family: i.family,
        name: i.name,
        description: i.description ?? "",
        sizeLabel: i.sizeLabel ?? "",
        uom: i.uom,
        active: i.active,
        specsJson: JSON.stringify(i.specs ?? {}),
        basePrice: i.priceList[0] ? Number(i.priceList[0].basePrice) : 0,
      }))}
      motorSeed={<MotorSeedButton present={motorsPresent} expected={motorCatalogueRows().length} />}
    />
  );
}
