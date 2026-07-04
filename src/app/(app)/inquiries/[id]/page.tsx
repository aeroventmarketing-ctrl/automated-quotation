import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InquiryStatusBadge, QuotationStatusBadge } from "@/components/status-badge";
import { formatDate, formatCurrency } from "@/lib/utils";
import { InquiryWorkspace } from "./inquiry-workspace";
import { RETAINED_TEMPLATE_LAYOUT_KEYS, ensureBuiltinTemplates, sortTemplatesByPickerOrder } from "@/lib/ensure-templates";
import { findContactOwner } from "@/lib/client-ownership";

export const dynamic = "force-dynamic";

export default async function InquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureBuiltinTemplates(); // make sure the built-in templates are in the picker
  const [inquiry, catalogue, templates] = await Promise.all([
    prisma.inquiry.findUnique({
      where: { id },
      include: {
        customer: true,
        createdBy: true,
        items: { orderBy: { id: "asc" } },
        attachments: true,
        quotations: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.catalogueItem.findMany({
      where: { active: true },
      select: {
        id: true,
        modelCode: true,
        name: true,
        family: true,
        sizeLabel: true,
        uom: true,
        description: true,
        priceList: { where: { active: true }, orderBy: { effectiveDate: "desc" }, take: 1 },
      },
    }),
    prisma.quotationTemplate.findMany({
      where: { active: true, layoutKey: { in: [...RETAINED_TEMPLATE_LAYOUT_KEYS] } },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!inquiry) notFound();

  // First-contact owner for this client's contact details (dispute authority).
  const owner = await findContactOwner({
    company: inquiry.customer.company,
    contactName: inquiry.customer.contactName,
  });

  const catalogueLite = catalogue.map((c) => ({
    id: c.id,
    modelCode: c.modelCode,
    name: c.name,
    family: c.family,
    sizeLabel: c.sizeLabel,
    uom: c.uom,
    description: c.description,
    basePrice: c.priceList[0] ? Number(c.priceList[0].basePrice) : 0,
    currency: c.priceList[0]?.currency ?? "PHP",
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{inquiry.customer.company}</h1>
          <p className="text-sm text-muted-foreground">
            {inquiry.source} · created by {inquiry.createdBy.name} · {formatDate(inquiry.createdAt)}
          </p>
        </div>
        <InquiryStatusBadge status={inquiry.status} />
      </div>

      {(inquiry.customer.contactName || owner) && (
        <Card>
          <CardContent className="space-y-3 pt-6 text-sm">
            {inquiry.customer.contactName && (
              <div className="grid gap-2 md:grid-cols-3">
                <div><span className="text-muted-foreground">Contact: </span>{inquiry.customer.contactName}</div>
                <div><span className="text-muted-foreground">Email: </span>{inquiry.customer.email ?? "—"}</div>
                <div><span className="text-muted-foreground">Phone: </span>{inquiry.customer.phone ?? "—"}</div>
              </div>
            )}
            {owner && (
              <div className="rounded-md bg-muted px-3 py-2">
                <span className="text-muted-foreground">Client authority: </span>
                <span className="font-medium">{owner.ownerName}</span>
                <span className="text-muted-foreground"> — first contact {formatDate(owner.at)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {inquiry.quotations.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Quotations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {inquiry.quotations.map((q) => (
              <Link key={q.id} href={`/quotations/${q.id}`} className="flex items-center justify-between rounded-md border p-3 hover:bg-accent">
                <span className="font-medium">{q.quoteNumber}</span>
                <span className="flex items-center gap-3">
                  <span className="text-sm">{formatCurrency(Number(q.total), q.currency)}</span>
                  <QuotationStatusBadge status={q.status} />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <InquiryWorkspace
        inquiryId={inquiry.id}
        projectName={inquiry.projectName ?? ""}
        items={inquiry.items.map((it) => ({
          id: it.id,
          rawText: it.rawText,
          qty: it.qty,
          parsedJson: it.parsedJson as Record<string, unknown>,
          status: it.status,
        }))}
        catalogue={catalogueLite}
        templates={sortTemplatesByPickerOrder(templates).map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
