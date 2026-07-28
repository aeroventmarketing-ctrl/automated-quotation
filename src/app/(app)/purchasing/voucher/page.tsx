import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { getSignatureMap } from "@/lib/signature";
import { claimPurchaseVoucherNo } from "@/lib/purchase-voucher";
import { pesoAmountInWords } from "@/lib/amount-words";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Payment voucher for one or more selected purchase requests. Generated from the
 * Purchasing workspace by ticking approved requests. Accounting / Payment Approver
 * / admin only. The voucher lists each request's supplier + PO with its net amount
 * and totals them — a faithful reproduction of AeroVent's cash-voucher pad.
 */
export default async function PurchasingVoucherPage({ searchParams }: { searchParams: Promise<{ ids?: string; print?: string }> }) {
  const { ids, print } = await searchParams;

  // Accounting / Payment Approver / admin only.
  const user = await getCurrentUser();
  if (!user) notFound();
  const assignments = await getWorkflowRoles();
  const allowed =
    isAdmin(user) ||
    (["accounting", "payment_approver"] as WorkflowRoleKey[]).some((r) => userHasWorkflowRole(assignments, user.id, r));
  if (!allowed) notFound();

  const idList = (ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (idList.length === 0) notFound();

  const prs = await prisma.purchaseRequest.findMany({ where: { id: { in: idList } } });

  // One voucher line per request that carries a Purchase Order (with its net amount).
  const lines = prs
    .map((pr) => {
      const po = coercePurchaseOrder(pr.po);
      if (!po) return null;
      return {
        supplier: po.supplier.company || "—",
        poNumber: po.poNumber || "",
        net: poTotals(po).net,
      };
    })
    .filter((l): l is { supplier: string; poNumber: string; net: number } => !!l);

  if (lines.length === 0) notFound();

  const total = lines.reduce((s, l) => s + l.net, 0);
  const dateStr = formatDate(new Date());

  // Signatories, resolved from the workflow-role assignments + uploaded
  // signatures: Prepared by = Accounting, Approved by = Payment Approver / admin,
  // Received by = Logistics head. Prefer the current viewer when they hold the role.
  const pickRoleUser = (role: WorkflowRoleKey): string | null => {
    const roleIds = usersWithWorkflowRole(assignments, role);
    if (roleIds.includes(user.id)) return user.id;
    return roleIds[0] ?? null;
  };
  const acctId = pickRoleUser("accounting");
  const payId = pickRoleUser("payment_approver") ?? (isAdmin(user) ? user.id : null);
  const logiId = pickRoleUser("logistics");
  const sigIds = [acctId, payId, logiId].filter((x): x is string => !!x);
  const sigUsers = sigIds.length
    ? await prisma.user.findMany({ where: { id: { in: sigIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(sigUsers.map((u) => [u.id, u.name]));
  const sigMap = await getSignatureMap();
  const signatory = (id: string | null) => ({ name: id ? nameById.get(id) ?? "" : "", sig: id ? sigMap[id] ?? null : null });
  const prepared = signatory(acctId);
  const approved = signatory(payId);
  const received = signatory(logiId);

  // "Paid to" is the Logistics head (who receives the cash to purchase).
  const paidTo = received.name;
  // System-wide auto-incrementing voucher number (shared with the cash voucher
  // counter, admin-set). Idempotent per selection so re-views reuse the number.
  const voucherNo = await claimPurchaseVoucherNo(idList);

  const rows = lines.map((l) => ({ description: `${l.supplier}${l.poNumber ? ` — P.O. ${l.poNumber}` : ""}`, amount: l.net }));
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
        <Link href="/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to purchasing
        </Link>
        <PrintButton auto={print === "1"} />
      </div>

      <div id="voucher-sheet" className="mx-auto max-w-[760px] rounded-md border bg-white p-10 text-black">
        <div className="flex items-start justify-between">
          <div className="text-sm font-semibold leading-tight">{COMPANY.name}</div>
        </div>

        <h1 className="mt-2 text-center text-2xl font-extrabold tracking-wide underline underline-offset-4">CASH VOUCHER</h1>

        {/* Auto-numbered voucher number, right-aligned, in red. */}
        <div className="mt-1 text-right text-sm">
          No.&nbsp;<span className="font-bold tracking-wide text-red-600">{voucherNo}</span>
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
                <td className="h-7 border-x border-black px-2 align-middle">{l.description}</td>
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
          <span className="font-semibold tabular-nums">{peso(total)}</span>) in full payment of amount described above.
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
                  <div className="min-w-[11rem] border-t border-black pt-0.5 text-center font-medium">{prepared.name || " "}</div>
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
            <div className="min-w-[12rem] border-t border-black pt-0.5 text-center font-medium">{received.name || " "}</div>
            <div className="text-center text-[11px] text-neutral-500">Logistics Head</div>
          </div>
        </div>
      </div>
    </div>
  );
}
