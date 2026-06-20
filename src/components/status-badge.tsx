import { Badge } from "@/components/ui/badge";
import type { InquiryStatus, QuotationStatus } from "@prisma/client";

const INQUIRY_VARIANT: Record<InquiryStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  NEW: "secondary",
  DRAFTING: "warning",
  QUOTED: "default",
  SENT: "default",
  WON: "success",
  LOST: "destructive",
};

const QUOTE_VARIANT: Record<QuotationStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  APPROVED: "success",
  SENT: "default",
};

export function InquiryStatusBadge({ status }: { status: InquiryStatus }) {
  return <Badge variant={INQUIRY_VARIANT[status]}>{status.replace("_", " ")}</Badge>;
}

export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  return <Badge variant={QUOTE_VARIANT[status]}>{status.replace("_", " ")}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const v = confidence === "HIGH" ? "success" : confidence === "MEDIUM" ? "warning" : "destructive";
  return <Badge variant={v}>{confidence}</Badge>;
}
