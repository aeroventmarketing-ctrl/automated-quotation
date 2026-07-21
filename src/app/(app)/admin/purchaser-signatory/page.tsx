import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPurchaserSignatory } from "@/lib/purchaser-signatory";
import { SignatoryManager } from "../signatory/signatory-manager";
import { savePurchaserSignatoryAction } from "./actions";

export const dynamic = "force-dynamic";

/** Admin page to set the purchaser signatory printed on the Purchase Order. */
export default async function PurchaserSignatoryPage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) redirect("/dashboard");

  const signatory = await getPurchaserSignatory();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Purchaser Signatory</h1>
        <p className="text-sm text-muted-foreground">
          The purchaser signed on every Purchase Order. The printed name appears above the
          &ldquo;Account Purchaser&rdquo; line and the uploaded signature image is placed over that
          line when you press <span className="font-medium">Print PO &amp; 2307</span>.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Purchaser signatory</CardTitle>
        </CardHeader>
        <CardContent>
          <SignatoryManager signatory={signatory} onSave={savePurchaserSignatoryAction} />
        </CardContent>
      </Card>
    </div>
  );
}
