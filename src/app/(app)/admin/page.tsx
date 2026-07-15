import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPropellerSpLock } from "@/lib/propeller-lock";
import { getAxialSpLock } from "@/lib/axial-lock";
import { getFollowUpSettings } from "@/lib/follow-up-settings";
import { getHideOrderProgress } from "@/lib/order-progress-visibility";
import { QuoteNumberSetting } from "./quote-number-setting";
import { MrfNumberSetting } from "./mrf-number-setting";
import { PoNumberSetting } from "./po-number-setting";
import { SpLockSetting } from "./sp-lock-setting";
import { FollowUpSetting } from "./follow-up-setting";
import { savePropellerSpLockSetting, saveAxialSpLockSetting, saveHideOrderProgressSetting, saveFollowUpSettingsAction, runFollowUpPreviewAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [users, catalogue, prices, ratings, templates, inquiries, quotations, counter, propellerSpLock, axialSpLock, followUpSettings, hideOrderProgress] = await Promise.all([
    prisma.user.count(),
    prisma.catalogueItem.count(),
    prisma.priceListEntry.count(),
    prisma.fanRatingPoint.count(),
    prisma.quotationTemplate.count(),
    prisma.inquiry.count(),
    prisma.quotation.count(),
    prisma.quoteCounter.findUnique({ where: { year: 0 } }),
    getPropellerSpLock(),
    getAxialSpLock(),
    getFollowUpSettings(),
    getHideOrderProgress(),
  ]);
  const nextQuoteSeq = (counter?.lastValue ?? 0) + 1;
  const mrfRow = await prisma.appSetting.findUnique({ where: { key: "mrf_counter" } });
  const mrfNext = (Number((mrfRow?.value as { last?: unknown } | null)?.last ?? 0) || 0) + 1;
  const poRow = await prisma.appSetting.findUnique({ where: { key: "po_counter" } });
  const poNext = (Number((poRow?.value as { last?: unknown } | null)?.last ?? 0) || 0) + 1;

  const stats = [
    { label: "Users", value: users, href: "/admin/users" },
    { label: "Catalogue items", value: catalogue, href: "/admin/catalogue" },
    { label: "Pricelist entries", value: prices, href: "/admin/catalogue" },
    { label: "Rating points", value: ratings, href: "/admin/ratings" },
    { label: "Templates", value: templates, href: "/admin/templates" },
    { label: "Inquiries", value: inquiries, href: "/inquiries" },
    { label: "Quotations", value: quotations, href: "/quotations" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-colors hover:bg-accent">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{s.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <Link href="/admin/workflow-roles">
        <Card className="transition-colors hover:bg-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Workflow roles →</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Assign ERP departmental roles (Accounting, Approver, Technical Head, Production heads,
              Warehouse, Purchaser, Logistics, Plant Manager) that drive order approvals.
            </p>
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/suppliers">
        <Card className="transition-colors hover:bg-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Suppliers →</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Maintain the supplier directory (company, attention, address) used when issuing supplier
              Purchase Orders. Suppliers are also saved automatically each time a PO is issued.
            </p>
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/payment-terms">
        <Card className="transition-colors hover:bg-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payment terms →</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Manage the supplier payment terms offered on Purchase Orders. The Purchaser can also add
              a term directly from the PO form.
            </p>
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/signatory">
        <Card className="transition-colors hover:bg-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">2307 Signatory →</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Set the payor&rsquo;s name, designation and signature image printed on the BIR 2307.
            </p>
          </CardContent>
        </Card>
      </Link>
      <QuoteNumberSetting current={nextQuoteSeq} />
      <MrfNumberSetting current={mrfNext} />
      <PoNumberSetting current={poNext} />
      <SpLockSetting
        title="Propeller Type static-pressure lock"
        description={'When enabled, Power Roof Ventilator and Wall Fan (Propeller Type) lines are capped at 0.5" w.g.: the builder warns above that and disables Run selection. Turn off to allow selecting these fans at any static pressure.'}
        enabled={propellerSpLock}
        onSave={savePropellerSpLockSetting}
      />
      <SpLockSetting
        title="Axial Type static-pressure lock"
        description={'When enabled, Tubeaxial is capped at 1.5" w.g. and Vaneaxial at 4" w.g.: the builder warns above that and disables Run selection. Turn off to allow selecting these fans at any static pressure.'}
        enabled={axialSpLock}
        onSave={saveAxialSpLockSetting}
      />
      <SpLockSetting
        title="Hide order progress from Sales & Engineer"
        description="When enabled, Sales and Engineer users no longer see an order's workflow progress (stages, approvals, job orders, materials, purchasing, delivery) — from Phase 1 onward. Admins and anyone assigned an ERP workflow role still see everything."
        enabled={hideOrderProgress}
        onSave={saveHideOrderProgressSetting}
      />
      <FollowUpSetting
        offsetsDays={followUpSettings.offsetsDays}
        maxNudges={followUpSettings.maxNudges}
        enabled={followUpSettings.enabled}
        dryRun={followUpSettings.dryRun}
        onSave={saveFollowUpSettingsAction}
        onPreview={runFollowUpPreviewAction}
      />
    </div>
  );
}
