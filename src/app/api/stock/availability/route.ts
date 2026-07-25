import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Quick availability + price lookup for Sales: search an item by name/SKU and
 * get back how many are free to sell (on hand − active reservations) and the
 * SELLING price, so a rep can answer a client on the phone without opening the
 * full inventory screen. Unit cost (the supplier's price) is deliberately never
 * returned here — Sales must not see cost. Returns [] for anyone not signed in
 * or if the inventory tables aren't set up yet.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ items: [] });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ items: [] });

  try {
    const list = await prisma.stockItem.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }],
      take: 25,
    });
    if (list.length === 0) return Response.json({ items: [] });

    const resv = await prisma.stockReservation.groupBy({
      by: ["stockItemId"],
      where: { active: true, stockItemId: { in: list.map((i) => i.id) } },
      _sum: { qty: true },
    });
    const reservedByItem = new Map(resv.map((r) => [r.stockItemId, Number(r._sum.qty ?? 0)]));

    const items = list.map((i) => {
      const onHand = Number(i.quantity);
      const reserved = Math.round((reservedByItem.get(i.id) ?? 0) * 1000) / 1000;
      const available = Math.round((onHand - reserved) * 1000) / 1000;
      return {
        id: i.id,
        sku: i.sku,
        name: i.name,
        unit: i.unit,
        category: i.category,
        location: i.location,
        onHand,
        available,
        sellPrice: Number(i.sellPrice),
      };
    });
    return Response.json({ items });
  } catch {
    return Response.json({ items: [], error: "not-set-up" });
  }
}
