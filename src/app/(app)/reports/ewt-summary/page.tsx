import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { COMPANY } from "@/lib/config";
import { ewtPeriod } from "@/lib/ewt-summary";
import { canUseEwtSummary } from "@/lib/ewt-access";
import { loadEwtSummary } from "@/lib/ewt-summary-data";
import { PeriodPicker, PrintButton } from "./ewt-controls";
import { EwtTable } from "./ewt-table";

export const dynamic = "force-dynamic";

/**
 * EWT Summary — the owner's template, live: Supplier EWT (1601-EQ) and Client EWT
 * (1701Q), by month or quarter, each row Paid once its proof of payment to BIR
 * is attached. See lib/ewt-summary.
 */
export default async function EwtSummaryPage({ searchParams }: { searchParams: Promise<{ mode?: string; period?: string }> }) {
  const sp = await searchParams;
  const [viewer, roles] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  if (!canUseEwtSummary(viewer, roles)) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">EWT Summary</h1>
        <p className="text-sm text-muted-foreground">The EWT Summary is for admins, the Payment Approver and Accounting.</p>
      </div>
    );
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const period = ewtPeriod(sp.mode, sp.period, today);
  const query = `mode=${period.mode}&period=${period.key}`;
  let data: Awaited<ReturnType<typeof loadEwtSummary>> | null = null;
  try {
    data = await loadEwtSummary(period);
  } catch (e) {
    console.error("EWT summary failed", e);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">EWT Summary</h1>
          <p className="text-sm text-muted-foreground">
            Supplier EWT we withheld on POs (1601-EQ) and Client EWT withheld from us on sales (1701Q). A row is Paid once its proof of payment to BIR is attached.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker mode={period.mode} periodKey={period.key} />
          <PrintButton />
        </div>
      </div>

      <div className="hidden text-center print:block">
        <div className="text-lg font-bold">{COMPANY.name}</div>
        <div className="text-sm font-semibold">EWT SUMMARY</div>
        <div className="text-xs">Generation: {period.mode === "quarter" ? "Quarterly" : "Monthly"} — {period.label}</div>
      </div>

      {!data ? (
        <p className="text-sm text-destructive">The EWT Summary couldn&apos;t be loaded just now. Refresh to try again.</p>
      ) : (
        <>
          {data.proofsMissing && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 print:hidden dark:bg-amber-950/40 dark:text-amber-200">
              Proofs can&apos;t be saved yet — apply migration <b>0063_ewt_remittance</b> in Supabase. Until then every row reads Unpaid.
            </p>
          )}
          <EwtTable kind="supplier" rows={data.supplier} periodLabel={period.label} query={query} />
          <EwtTable kind="client" rows={data.client} periodLabel={period.label} query={query} />
        </>
      )}
    </div>
  );
}
