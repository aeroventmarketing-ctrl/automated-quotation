import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCounterSaleViewer } from "@/lib/counter-sale-access";
import { CounterSaleForm } from "../counter-sale-form";

export const dynamic = "force-dynamic";

export default async function NewCounterSalePage() {
  const { allowed } = await getCounterSaleViewer();
  if (!allowed) redirect("/counter-sales");

  const [customers, stockItems, salespeople] = await Promise.all([
    prisma.customer.findMany({ orderBy: { company: "asc" }, select: { id: true, company: true } }),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, sellPrice: true, quantity: true } }),
    prisma.user.findMany({ where: { role: "SALES" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">New Counter Sale</h1>
        <p className="text-sm text-muted-foreground">Record a walk-in purchase. Documents are attached and stock is deducted after you complete the sale.</p>
      </div>
      <CounterSaleForm
        customers={customers}
        stockItems={stockItems.map((s) => ({ id: s.id, name: s.name, unit: s.unit, sellPrice: Number(s.sellPrice), quantity: Number(s.quantity) }))}
        salespeople={salespeople}
      />
    </div>
  );
}
