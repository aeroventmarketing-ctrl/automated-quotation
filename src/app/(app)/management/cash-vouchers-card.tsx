"use client";

/**
 * Management "Cash vouchers" card — collapsible, with clickable rows that open the
 * voucher, and a real status per row. Rendered from the management page's merged
 * voucher list (PO-based printed vouchers + released cash-request vouchers).
 * Display-only; no workflow logic here.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Banknote, ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const CURRENCY = "PHP";

export interface CashVoucherView {
  no: string;
  kind: "po" | "cash";
  paidTo: string;
  detail: string;
  total: number;
  approvedTotal: number;
  state: "mismatch" | "awaiting" | "tallied";
  /** Raw cash-request status (cash rows only) — drives the settled/etc. badge. */
  cashStatus: string | null;
  /** Short human label for the cash status ("Settled", "Liquidated", …). */
  statusLabel: string | null;
  printedByName: string;
  printedAt: string;
  href: string;
}

function StatusBadge({ v }: { v: CashVoucherView }) {
  if (v.kind === "cash") {
    const variant = v.cashStatus === "SETTLED" ? "success" : v.cashStatus === "LIQUIDATED" ? "default" : "secondary";
    return <Badge variant={variant}>{v.statusLabel ?? "Cash voucher"}</Badge>;
  }
  return v.state === "mismatch" ? (
    <Badge variant="warning">Not tallied</Badge>
  ) : v.state === "awaiting" ? (
    <Badge variant="secondary">Awaiting reconciliation</Badge>
  ) : (
    <Badge variant="success">Tallied</Badge>
  );
}

export function CashVouchersCard({ vouchers }: { vouchers: CashVoucherView[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const notTallied = vouchers.filter((v) => v.kind === "po" && v.state === "mismatch").length;
  const awaiting = vouchers.filter((v) => v.kind === "po" && v.state === "awaiting").length;
  const cashCount = vouchers.filter((v) => v.kind === "cash").length;
  const total = vouchers.reduce((s, v) => s + v.total, 0);

  return (
    <Card className="mt-4 shadow-sm">
      <CardHeader className="pb-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <CardTitle className="flex flex-1 flex-wrap items-center gap-x-2 text-sm">
            <span className="flex items-center gap-2"><Banknote className="h-4 w-4 text-muted-foreground" /> Cash vouchers</span>
            {vouchers.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({notTallied} not tallied · {awaiting} awaiting reconciliation{cashCount > 0 ? ` · ${cashCount} cash` : ""} · {formatCurrency(total, CURRENCY)} total)
              </span>
            )}
          </CardTitle>
          <span className="shrink-0 text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          {vouchers.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No cash vouchers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Voucher No.</th>
                    <th className="py-1.5 pr-3 font-medium">Details</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 font-medium">Printed</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((v) => (
                    <tr
                      key={v.no}
                      onClick={() => router.push(v.href)}
                      className="cursor-pointer border-b align-top transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td className="py-1.5 pr-3 font-semibold tabular-nums text-red-600 underline-offset-2 hover:underline">{v.no}</td>
                      <td className="py-1.5 pr-3">
                        <div className="font-medium">Paid to {v.paidTo || "—"}</div>
                        <div className="text-xs text-muted-foreground">{v.detail}</div>
                        {v.kind === "po" && v.state === "mismatch" && (
                          <div className="text-xs text-amber-700">Approved total {formatCurrency(v.approvedTotal, CURRENCY)} · voucher {formatCurrency(v.total, CURRENCY)}</div>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatCurrency(v.total, CURRENCY)}</td>
                      <td className="py-1.5 pr-3"><StatusBadge v={v} /></td>
                      <td className="py-1.5 text-xs text-muted-foreground">{v.printedByName}{v.printedAt ? ` · ${formatDateTime(v.printedAt)}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
