import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSignatory } from "@/lib/signatory";
import { SignatoryManager } from "./signatory-manager";
import { saveSignatoryAction } from "./actions";

export const dynamic = "force-dynamic";

/** Admin page to set the payor signatory printed on the BIR 2307. */
export default async function SignatoryPage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) redirect("/dashboard");

  const signatory = await getSignatory();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">2307 Signatory</h1>
        <p className="text-sm text-muted-foreground">
          The payor&rsquo;s authorized representative signed on every BIR 2307. The printed name and
          designation appear above the &ldquo;Signature over Printed Name of Payor&rdquo; line, and the
          uploaded signature image is placed over that line.
        </p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Payor signatory</CardTitle>
        </CardHeader>
        <CardContent>
          <SignatoryManager signatory={signatory} onSave={saveSignatoryAction} />
        </CardContent>
      </Card>
    </div>
  );
}
