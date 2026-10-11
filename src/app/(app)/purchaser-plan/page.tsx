import { redirect } from "next/navigation";

/**
 * Renamed: the owner — *"rename purchaser plan to purchase plan"*. The page lives
 * at /purchase-plan now; this keeps any link or bookmark to the old address
 * working.
 */
export default function PurchaserPlanRedirect() {
  redirect("/purchase-plan");
}
