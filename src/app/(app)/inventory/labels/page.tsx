import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { code128Svg } from "@/lib/code128";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const admin = isAdmin(viewer);
  const canView =
    admin ||
    (viewer != null && (["warehouse", "plant_manager", "purchaser"] as const).some((r) => userHasWorkflowRole(assignments, viewer.id, r)));
  if (!canView) {
    return <div className="space-y-2"><h1 className="text-2xl font-bold">Labels</h1><p className="text-sm text-muted-foreground">No access.</p></div>;
  }

  const items = await prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Stock labels</h1>
          <p className="text-sm text-muted-foreground">Code 128 barcodes — scannable by any barcode scanner. Print and stick on bins/items.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventory" className="rounded-md border px-3 py-2 text-sm hover:bg-accent">← Inventory</Link>
          <PrintButton />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stock items yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((i) => (
            <div key={i.id} className="flex flex-col items-center gap-1 rounded-md border p-3 text-center break-inside-avoid">
              <div className="text-sm font-semibold leading-tight">{i.name}</div>
              <div className="text-xs text-muted-foreground">
                {[i.location ? `Loc ${i.location}` : null, i.unit].filter(Boolean).join(" · ")}
              </div>
              <div
                className="mt-1 w-full overflow-hidden"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: code128Svg(i.id, { moduleWidth: 1.6, height: 46, showText: false }) }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
