import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getDocViewers } from "@/lib/doc-viewers";
import { DocumentAccessManager } from "./document-access-manager";
import { saveDocViewersAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DocumentAccessPage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) {
    return <div className="space-y-2"><h1 className="text-2xl font-bold">Document access</h1><p className="text-sm text-muted-foreground">Admin access required.</p></div>;
  }
  const [users, granted] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    getDocViewers(),
  ]);

  return (
    <div className="space-y-4">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Admin
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Document access</h1>
        <p className="text-sm text-muted-foreground">
          Choose who may view sale/order documents (Purchase Order, Computation, Quotation, invoices, delivery receipts, BIR 2307, etc.).
          Admins and each quote&apos;s preparer can always view; grant access to anyone else below.
        </p>
      </div>
      <DocumentAccessManager
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: String(u.role) }))}
        initialGranted={granted}
        onSave={saveDocViewersAction}
      />
    </div>
  );
}
