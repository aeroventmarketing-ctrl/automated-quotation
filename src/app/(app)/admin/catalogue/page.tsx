import { prisma } from "@/lib/db";
import { motorCatalogueRows, MOTOR_CODE_PREFIX } from "@/lib/motor-catalogue";
import { CatalogueManager } from "./catalogue-manager";
import { MotorSeedButton } from "./motor-seed-button";

export const dynamic = "force-dynamic";

export default async function AdminCataloguePage() {
  const items = await prisma.catalogueItem.findMany({
    orderBy: [{ family: "asc" }, { modelCode: "asc" }],
    include: { priceList: { where: { variantKey: "default" }, take: 1 } },
  });

  /**
   * Counted here rather than asked of the database.
   *
   * This WAS `count({ where: { family: "MOTOR" } })`, and it took the page down
   * with a 500 in production: `MOTOR` is a new enum value that arrives with a
   * migration, the deploy does not run migrations, so the code was live for
   * minutes before the value existed and every query naming it threw. Counting
   * over rows already in hand cannot fail that way — and it is one query fewer.
   */
  const motorsPresent = items.filter((i) => i.modelCode.startsWith(MOTOR_CODE_PREFIX)).length;

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
