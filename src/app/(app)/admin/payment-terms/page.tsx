import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPaymentTerms } from "@/lib/payment-terms";
import { PaymentTermsManager } from "./payment-terms-manager";
import { savePaymentTermAction, deletePaymentTermAction } from "./actions";

export const dynamic = "force-dynamic";

/** Admin page to maintain the supplier payment terms used on Purchase Orders. */
export default async function PaymentTermsPage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) redirect("/dashboard");

  const terms = await getPaymentTerms();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Payment terms</h1>
        <p className="text-sm text-muted-foreground">
          The supplier payment terms offered on a Purchase Order. The Purchaser can also add a term
          directly from the PO form.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Payment term list ({terms.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentTermsManager terms={terms} onSave={savePaymentTermAction} onDelete={deletePaymentTermAction} />
        </CardContent>
      </Card>
    </div>
  );
}
