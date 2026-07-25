import { prisma } from "@/lib/db";
import { NewInquiryForm } from "./new-inquiry-form";
import { StockAvailabilitySearch } from "@/components/stock-availability-search";

export const dynamic = "force-dynamic";

export default async function NewInquiryPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { company: "asc" },
    select: { id: true, company: true },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Inquiry</h1>
      {/* Check stock availability and verify the selling price while capturing
          the client's request. */}
      <div className="grid gap-4 md:grid-cols-2">
        <StockAvailabilitySearch variant="availability" />
        <StockAvailabilitySearch variant="price" />
      </div>
      <NewInquiryForm customers={customers} />
    </div>
  );
}
