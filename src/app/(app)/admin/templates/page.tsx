import { prisma } from "@/lib/db";
import { ensureKdkTemplate } from "@/lib/ensure-templates";
import { TemplatesManager } from "./templates-manager";

export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  await ensureKdkTemplate();
  const templates = await prisma.quotationTemplate.findMany({ orderBy: { name: "asc" } });
  return (
    <TemplatesManager
      templates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        layoutKey: t.layoutKey,
        active: t.active,
        configJson: JSON.stringify(t.config ?? {}, null, 2),
      }))}
    />
  );
}
