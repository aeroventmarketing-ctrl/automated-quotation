import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { commissionAccess } from "@/lib/commission-access";
import { getSignatureMap } from "@/lib/signature";
import { pesoAmountInWords } from "@/lib/amount-words";
import { round2 } from "@/lib/quote";
import { buildCommissions, allDeals, isPayable, dealKey, COMMISSION_RATE_PCT, OVERRIDE_RATE_PCT } from "@/lib/sales-commission";
import { getCommissionVoucherNo, recordPrintedCommissionVoucher } from "@/lib/commission-voucher";
import { PrintButton } from "../../purchasing/voucher/print-button";

export const dynamic = "force-dynamic";

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * ONE cash voucher per salesperson, totalling every commission they have earned
 * and not yet been paid — the owner's rule: *"voucher creation for release of
 * commission is per sales personnel. Total every approved inquiry and make a
 * single cash voucher per sales personnel."*
 *
 * Not per order and not per month: a salesperson with four settled August deals
 * and one September deal is paid on one voucher for all five. Each particular
 * line names the order it came from and the release date it qualified on, so the
 * voucher is auditable back to the individual commissions.
 *
 * Accounting / Payment Approver / admin only — the same audience as the
 * purchasing voucher, whose layout this reproduces.
 */
export default async function CommissionVoucherPage({
  searchParams,
}: {
  searchParams: Promise<{ salesperson?: string; print?: string }>;
}) {
  const { salesperson, print } = await searchParams;

  const user = await getCurrentUser();
  if (!user) notFound();
  const assignments = await getWorkflowRoles();
  // The same rule the Commissions page uses. Deliberately `canSeeAll`, not
  // `canView`: a salesperson must not be able to print their own cash voucher.
  const { canSeeAll } = commissionAccess({
    admin: isAdmin(user),
    baseRole: user.role,
    workflowRoles: WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey)),
    salesPersonnel: false, // irrelevant to canSeeAll; the voucher is a finance screen
  });
  if (!canSeeAll) notFound();
  if (!salesperson) notFound();

  // Everything this person has earned and not been paid — across every month,
  // both their own 1.5% and any Sales Head override they are owed.
  const view = await buildCommissions({ salespersonId: salesperson }).catch(() => null);
  if (!view) notFound();
  const due = allDeals(view).filter(isPayable);
  if (due.length === 0) notFound();

  const paidTo = due[0].salespersonName;
  const total = round2(due.reduce((s, d) => s + d.amount, 0));
  const dateStr = formatDate(new Date());

  // Oldest release first — the voucher reads as a settlement of a backlog.
  const ordered = [...due].sort(
    (a, b) => (a.payoutYMD ?? "").localeCompare(b.payoutYMD ?? "") || a.refLabel.localeCompare(b.refLabel),
  );
  const particulars = ordered.map((d) => ({
    description:
      `${d.refLabel} · ${d.company}` +
      (d.payeeKind === "override"
        ? ` — ${OVERRIDE_RATE_PCT}% override on ${d.sourceSalespersonName ?? "a sale"}`
        : ` — ${COMMISSION_RATE_PCT}% of ${peso(d.net)}`) +
      (d.payoutYMD ? ` · rel. ${formatDate(d.payoutYMD)}` : ""),
    amount: d.amount,
  }));
  const dealKeys = ordered.map(dealKey);

  // Signatories: Prepared by = Accounting, Approved by = Payment Approver / admin,
  // Received by = the salesperson being paid. Prefer the viewer where they hold
  // the role, matching the purchasing voucher.
  const pickRoleUser = (role: WorkflowRoleKey): string | null => {
    const roleIds = usersWithWorkflowRole(assignments, role);
    if (roleIds.includes(user.id)) return user.id;
    return roleIds[0] ?? null;
  };
  const acctId = pickRoleUser("accounting");
  const payId = pickRoleUser("payment_approver") ?? (isAdmin(user) ? user.id : null);
  const sigIds = [acctId, payId, salesperson].filter((x): x is string => !!x);
  const sigUsers = await prisma.user.findMany({ where: { id: { in: sigIds } }, select: { id: true, name: true } });
  const nameById = new Map(sigUsers.map((u) => [u.id, u.name]));
  const sigMap = await getSignatureMap();
  const signatory = (id: string | null) => ({ name: id ? nameById.get(id) ?? "" : "", sig: id ? sigMap[id] ?? null : null });
  const prepared = signatory(acctId);
  const approved = signatory(payId);
  const received = signatory(salesperson);

  // The number is CLAIMED (and the voucher recorded) only on print; viewing is
  // read-only. Reprinting the same set of commissions reuses the number.
  const voucherNo =
    print === "1"
      ? await recordPrintedCommissionVoucher({
          salespersonId: salesperson,
          paidTo,
          dealKeys,
          lines: particulars,
          total,
          printedByName: user.name,
          printedAt: new Date().toISOString(),
        })
      : await getCommissionVoucherNo(salesperson, dealKeys);

  const rows = [...particulars];
  while (rows.length < 8) rows.push({ description: "", amount: 0 });

  return (
    <div>
      <style>{`
        @page { size: auto; margin: 0; }
        @media print {
          html, body { margin: 0 !important; }
          body * { visibility: hidden !important; }
          #voucher-sheet, #voucher-sheet * { visibility: visible !important; }
          #voucher-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 14mm !important; border: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/commissions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to commissions
        </Link>
        <PrintButton auto={print === "1"} />
      </div>

      <div id="voucher-sheet" className="mx-auto max-w-[760px] rounded-md border bg-white p-10 text-black">
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold leading-tight">{COMPANY.name}</div>
        </div>

        <h1 className="mt-2 text-center text-2xl font-extrabold tracking-wide underline underline-offset-4">CASH VOUCHER</h1>
        <p className="text-center text-[11px] uppercase tracking-[0.3em] text-neutral-500">Sales commission</p>

        <div className="mt-1 text-right text-sm">
          No.&nbsp;
          {voucherNo ? (
            <span className="font-bold tracking-wide text-red-600">{voucherNo}</span>
          ) : (
            <span className="text-neutral-400 no-print">(assigned when printed)</span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-6 text-sm">
          <div className="flex-1 space-y-2">
            <div className="flex items-end gap-2">
              <span className="shrink-0">Paid to</span>
              <span className="flex-1 border-b border-black px-1 font-medium">{paidTo}</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="shrink-0">Address</span>
              <span className="flex-1 border-b border-black px-1">&nbsp;</span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className="shrink-0">Date</span>
            <span className="min-w-[7rem] border-b border-black px-1 text-center">{dateStr}</span>
          </div>
        </div>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-black py-1.5 text-center font-bold tracking-[0.2em]">PARTICULAR</th>
              <th className="w-40 border border-black py-1.5 text-center font-bold tracking-wide">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td className="h-7 border-x border-black px-2 align-middle text-[13px]">{l.description}</td>
                <td className="h-7 border-x border-black px-2 text-right align-middle tabular-nums">{l.amount ? peso(l.amount) : ""}</td>
              </tr>
            ))}
            <tr>
              <td className="border border-black px-2 py-1.5 text-right font-semibold">TOTAL&nbsp;&nbsp;&nbsp;Php</td>
              <td className="border border-black px-2 py-1.5 text-right font-bold tabular-nums">{peso(total)}</td>
            </tr>
          </tbody>
        </table>

        <p className="mt-4 text-sm leading-relaxed">
          RECEIVED from <span className="font-medium">{COMPANY.name}</span> the amount of{" "}
          <span className="font-semibold">{pesoAmountInWords(total)}</span> PESOS (Php&nbsp;
          <span className="font-semibold tabular-nums">{peso(total)}</span>) in full payment of the sales commission
          described above.
        </p>

        <div className="mt-8 flex items-end justify-between gap-8">
          <table className="border-collapse text-sm">
            <tbody>
              <tr>
                <td className="border border-black px-3 pt-1 align-top">
                  <div>Prepared by:</div>
                  <div className="flex h-12 items-end justify-center">
                    {prepared.sig && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={prepared.sig} alt="" className="max-h-12 object-contain" />
                    )}
                  </div>
                  <div className="min-w-[11rem] border-t border-black pt-0.5 text-center font-medium">{prepared.name || " "}</div>
                  <div className="text-center text-[11px] text-neutral-500">Accounting</div>
                </td>
                <td className="border border-black px-3 pt-1 align-top">
                  <div>Approved by:</div>
                  <div className="flex h-12 items-end justify-center">
                    {approved.sig && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={approved.sig} alt="" className="max-h-12 object-contain" />
                    )}
                  </div>
                  <div className="min-w-[11rem] border-t border-black pt-0.5 text-center">&nbsp;</div>
                  <div className="text-center text-[11px] text-neutral-500">Payment Approver</div>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="text-sm">
            <div>Received by:</div>
            <div className="flex h-12 items-end justify-center">
              {received.sig && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={received.sig} alt="" className="max-h-12 object-contain" />
              )}
            </div>
            <div className="min-w-[12rem] border-t border-black pt-0.5 text-center font-medium">{received.name || " "}</div>
            <div className="text-center text-[11px] text-neutral-500">Sales</div>
          </div>
        </div>
      </div>
    </div>
  );
}
