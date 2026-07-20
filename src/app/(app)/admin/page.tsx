import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPropellerSpLock } from "@/lib/propeller-lock";
import { getAxialSpLock } from "@/lib/axial-lock";
import { getFollowUpSettings } from "@/lib/follow-up-settings";
import { getHideOrderProgress } from "@/lib/order-progress-visibility";
import { getNotificationsEnabled } from "@/lib/notification-settings";
import { getDocCheckGateEnabled } from "@/lib/doc-check-gate";
import { getStockLocations } from "@/lib/stock-locations";
import { getAiUsageLimit, currentMonthUsage, evaluateUsageAlert } from "@/lib/ai/usage";
import { StockLocationsSetting } from "./stock-locations-setting";
import { QuoteNumberSetting } from "./quote-number-setting";
import { MrfNumberSetting } from "./mrf-number-setting";
import { PoNumberSetting } from "./po-number-setting";
import { JoNumberSetting } from "./jo-number-setting";
import { CashNumberSetting } from "./cash-number-setting";
import { SpLockSetting } from "./sp-lock-setting";
import { FollowUpSetting } from "./follow-up-setting";
import { savePropellerSpLockSetting, saveAxialSpLockSetting, saveHideOrderProgressSetting, saveNotificationsSetting, saveDocCheckGateSetting, saveStockLocationsAction, saveFollowUpSettingsAction, runFollowUpPreviewAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [users, catalogue, prices, ratings, templates, inquiries, quotations, counter, propellerSpLock, axialSpLock, followUpSettings, hideOrderProgress, notificationsEnabled, stockLocations, docCheckGate] = await Promise.all([
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
    getNotificationsEnabled(),
    getStockLocations(),
    getDocCheckGateEnabled(),
  ]);
  const nextQuoteSeq = (counter?.lastValue ?? 0) + 1;
  const mrfRow = await prisma.appSetting.findUnique({ where: { key: "mrf_counter" } });
  const mrfNext = (Number((mrfRow?.value as { last?: unknown } | null)?.last ?? 0) || 0) + 1;
  const poRow = await prisma.appSetting.findUnique({ where: { key: "po_counter" } });
  const poNext = (Number((poRow?.value as { last?: unknown } | null)?.last ?? 0) || 0) + 1;
  const joRow = await prisma.appSetting.findUnique({ where: { key: "jo_counter" } });
  const joNext = (Number((joRow?.value as { last?: unknown } | null)?.last ?? 0) || 0) + 1;
  const cashRow = await prisma.appSetting.findUnique({ where: { key: "cash_request_counter" } });
  const cashNext = (Number((cashRow?.value as { n?: unknown } | null)?.n ?? 0) || 0) + 1;
  const [aiLimit, aiThisMonth] = await Promise.all([getAiUsageLimit(), currentMonthUsage()]);
  const aiAlert = evaluateUsageAlert(aiThisMonth, aiLimit);

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
      {aiAlert.level !== "ok" && (
        <Link href="/admin/ai-usage" className="block">
          <div className={`rounded-md border p-3 text-sm transition-colors ${aiAlert.level === "over" ? "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10" : "border-amber-500/40 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10"}`}>
            <p className="font-semibold">{aiAlert.level === "over" ? "AI usage limit reached this month" : "AI usage nearing the monthly limit"}</p>
            <ul className="mt-0.5 list-disc pl-5 text-xs">
              {aiAlert.messages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            <p className="mt-1 text-xs underline">Open AI usage →</p>
          </div>
        </Link>
      )}
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
      <Link href="/admin/ai-usage">
        <Card className="transition-colors hover:bg-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI usage →</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Monthly Claude token usage for the AI features (receipt reading, inquiry &amp; quotation extraction),
              billed by Anthropic. Set price env vars to also see an estimated cost.
            </p>
          </CardContent>
        </Card>
      </Link>
      <Link href="/admin/document-access">
        <Card className="transition-colors hover:bg-accent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Document access →</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Grant users permission to view sale/order documents (PO, Computation, Quotation, invoices, delivery
              receipts, BIR 2307, etc.). Admins and each quote&rsquo;s preparer can always view.
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
      <JoNumberSetting current={joNext} />
      <CashNumberSetting current={cashNext} />
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
      <SpLockSetting
        title="Approver notification alarm"
        description="When enabled, an approver hears a loud 20-second alarm and sees a flashing pop-up whenever an order is waiting on their approval. Turn off to silence the alarm for everyone (the order workflow is unaffected)."
        enabled={notificationsEnabled}
        onSave={saveNotificationsSetting}
      />
      <SpLockSetting
        title="Require documents before ‘Mark documents checked’"
        description="When enabled, an order's documents can only be marked checked once the Purchase Order, Computation, Quotation, and RFQ/BOQ are attached. Turn off (e.g. while testing) to allow marking documents checked without the attachments."
        enabled={docCheckGate}
        onSave={saveDocCheckGateSetting}
      />
      <StockLocationsSetting initial={stockLocations} onSave={saveStockLocationsAction} />
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
