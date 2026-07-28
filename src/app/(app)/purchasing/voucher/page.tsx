import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { formatDate } from "@/lib/utils";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
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
  const suppliers = [...new Set(lines.map((l) => l.supplier))];
  const paidTo = suppliers.length === 1 ? suppliers[0] : "Various suppliers (see particulars)";
  const dateStr = formatDate(new Date());

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
          <div className="text-sm">Requests:&nbsp;<span className="font-bold tabular-nums">{lines.length}</span></div>
        </div>

        <h1 className="mt-2 text-center text-2xl font-extrabold tracking-wide underline underline-offset-4">PAYMENT VOUCHER</h1>

        <div className="mt-5 flex items-end justify-between gap-6 text-sm">
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
                <td className="border border-black px-3 pb-6 pt-1 align-top">
                  <div>Prepared by:</div>
                  <div className="mt-4 min-w-[10rem] text-center font-medium">&nbsp;</div>
                </td>
                <td className="border border-black px-3 pb-6 pt-1 align-top">
                  <div>Approved by:</div>
                  <div className="mt-4 min-w-[10rem] text-center font-medium">&nbsp;</div>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flex-1 text-right text-sm">
            <div className="inline-block text-left">
              <div>By:</div>
              <div className="mt-2 min-w-[12rem] border-b border-black px-1 text-center font-medium">&nbsp;</div>
              <div className="text-[11px] text-neutral-500">(received by)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
