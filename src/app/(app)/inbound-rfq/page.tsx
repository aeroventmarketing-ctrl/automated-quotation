import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getInboundQueue } from "@/lib/inbound-rfq";
import { InboundReviewQueue } from "./review-queue";
import { createInquiryFromInbound, dismissInboundItem } from "./actions";

export const dynamic = "force-dynamic";

export default async function InboundRfqPage() {
  const user = await getCurrentUser();
  if (!user || !(isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER")) redirect("/dashboard");

  const items = (await getInboundQueue()).slice().reverse(); // newest first
  const configured = !!process.env.INBOUND_WEBHOOK_SECRET;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">Inbound RFQs</h1>
        <p className="text-sm text-muted-foreground">
          Client replies with an RFQ land here for review. Turn one into an inquiry (it then flows into the
          normal Inquiries → Quotations pipeline) or dismiss it.
        </p>
      </div>
      <InboundReviewQueue items={items} configured={configured} onCreate={createInquiryFromInbound} onDismiss={dismissInboundItem} />
    </div>
  );
}
