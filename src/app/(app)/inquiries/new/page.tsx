import { prisma } from "@/lib/db";
import { NewInquiryForm } from "./new-inquiry-form";
import { StockAvailabilitySearch } from "@/components/stock-availability-search";

export const dynamic = "force-dynamic";

export default async function NewInquiryPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const customers = await prisma.customer.findMany({
    orderBy: { company: "asc" },
    select: { id: true, company: true },
  });
  const initialCustomerId = customerId && customers.some((c) => c.id === customerId) ? customerId : undefined;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Inquiry</h1>
      {/* Check stock availability & price while capturing the client's request. */}
      <StockAvailabilitySearch />
      <NewInquiryForm customers={customers} initialCustomerId={initialCustomerId} />
    </div>
  );
}
