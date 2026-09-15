import { HandCoins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AttachProof, ProofList } from "./proof-of-payment";
import type { AwaitingConfirmation } from "@/lib/commission-receipt";

/**
 * Money that has left the company and nobody has signed for yet — Accounting's
 * chase list, and where the proof of payment is attached.
 *
 * It sits below "Ready for payout" because that is the order the two happen in:
 * release the voucher, then evidence it, then wait for the payee to confirm. A
 * slip cannot be attached before the payout exists (the `Commission` row is
 * written when the voucher is marked paid), so offering it any earlier would only
 * be a button that refuses.
 */
export function AwaitingConfirmationPanel({
  rows,
  canAttachProof,
  currency,
}: {
  rows: AwaitingConfirmation[];
  canAttachProof: boolean;
  currency: string;
}) {
  if (rows.length === 0) return null;
  const grand = rows.reduce((a, r) => a + r.total, 0);
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HandCoins className="h-4 w-4 text-muted-foreground" /> Paid — awaiting the payee&apos;s confirmation
        </CardTitle>
        <span className="text-sm font-semibold tabular-nums">{formatCurrency(grand, currency)}</span>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.salespersonId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{r.salespersonName}</p>
              <p className="text-[11px] text-muted-foreground">
                {r.count} commission{r.count === 1 ? "" : "s"}
                {r.paidAt ? ` · released ${formatDate(r.paidAt)}` : ""}
              </p>
              <p className="mt-1">
                <ProofList
                  docs={r.proof}
                  salespersonId={r.salespersonId}
                  canAttach={canAttachProof}
                  emptyNote="No proof of payment attached yet"
                />
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums">{formatCurrency(r.total, currency)}</span>
              {canAttachProof && <AttachProof salespersonId={r.salespersonId} salespersonName={r.salespersonName} />}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
