import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { LabelSheet, type LabelItem } from "./label-sheet";

export const dynamic = "force-dynamic";

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const [viewer, assignments, sp] = await Promise.all([getCurrentUser(), getWorkflowRoles(), searchParams]);
  const admin = isAdmin(viewer);
  const canView =
    admin ||
    (viewer != null && (["warehouse", "plant_manager", "purchaser"] as const).some((r) => userHasWorkflowRole(assignments, viewer.id, r)));
  if (!canView) {
    return <div className="space-y-2"><h1 className="text-2xl font-bold">Labels</h1><p className="text-sm text-muted-foreground">No access.</p></div>;
  }

  const rows = await prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const items: LabelItem[] = rows.map((i) => ({
    id: i.id,
    code: i.sku ?? i.id,
    sku: i.sku,
    name: i.name,
    location: i.location,
    unit: i.unit,
  }));
  const initialSelected = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Stock labels</h1>
        <p className="text-sm text-muted-foreground">No stock items yet.</p>
      </div>
    );
  }
  return <LabelSheet items={items} initialSelected={initialSelected} />;
}
