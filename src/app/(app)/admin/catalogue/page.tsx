import { prisma } from "@/lib/db";
import { CatalogueManager } from "./catalogue-manager";

export const dynamic = "force-dynamic";

export default async function AdminCataloguePage() {
  const items = await prisma.catalogueItem.findMany({
    orderBy: [{ family: "asc" }, { modelCode: "asc" }],
    include: { priceList: { where: { variantKey: "default" }, take: 1 } },
  });

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
    />
  );
}
