import { prisma } from "@/lib/db";
import { NewInquiryForm } from "./new-inquiry-form";

export const dynamic = "force-dynamic";

export default async function NewInquiryPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { company: "asc" },
    select: { id: true, company: true },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Inquiry</h1>
      <NewInquiryForm customers={customers} />
    </div>
  );
}
