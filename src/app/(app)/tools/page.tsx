import { prisma } from "@/lib/db";
import { getMotorPrices } from "@/lib/motor-prices";
import { SelectionTool } from "./selection-tool";

export const dynamic = "force-dynamic";

/** The duty a calculator handed over (`/tools?airflow=…&pressure=…`) — e.g. Pressurization's "Select fan". */
type DutyParams = { airflow?: string; airflowUnit?: string; pressure?: string; pressureUnit?: string };

export default async function SelectionPage({ searchParams }: { searchParams: Promise<DutyParams> }) {
  const sp = await searchParams;
  const pick = (v: string | undefined, allowed: string[]) => (v && allowed.includes(v) ? v : undefined);
  const initial = {
    airflow: sp.airflow && Number(sp.airflow) > 0 ? sp.airflow : "",
    airflowUnit: pick(sp.airflowUnit, ["cfm", "m3hr"]) ?? "cfm",
    pressure: sp.pressure && Number(sp.pressure) > 0 ? sp.pressure : "",
    pressureUnit: pick(sp.pressureUnit, ["inwg", "pa"]) ?? "inwg",
  };
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
      <SelectionTool priceMap={priceMap} motorPrices={motorPrices} initial={initial} />
    </div>
  );
}
