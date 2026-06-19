import { prisma } from "@/lib/db";
import { RatingsManager } from "./ratings-manager";

export const dynamic = "force-dynamic";

export default async function AdminRatingsPage() {
  const models = await prisma.catalogueItem.findMany({
    where: { ratingPoints: { some: {} } },
    orderBy: { modelCode: "asc" },
    include: { ratingPoints: { orderBy: [{ rpm: "asc" }, { airflow_m3hr: "asc" }] } },
  });

  return (
    <RatingsManager
      models={models.map((m) => ({
        modelCode: m.modelCode,
        name: m.name,
        points: m.ratingPoints.map((r) => ({
          id: r.id,
          rpm: r.rpm,
          airflow_m3hr: r.airflow_m3hr,
          staticPressure_pa: r.staticPressure_pa,
          power_kw: r.power_kw,
          efficiency: r.efficiency,
        })),
      }))}
    />
  );
}
