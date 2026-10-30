import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { poAmountChanged, type PoAmount } from "@/lib/po-edit-access";

/**
 * Shown in a PO edit form, above Save, the moment an edit at Voucher ready moves
 * the amount: saving will send the PO back to the Payment Approver (see
 * `sendsBackForApproval`). `saved` is the PO's amount as the voucher was drawn —
 * null when the PO isn't at Voucher ready, and then nothing shows.
 */
export function SendBackNotice({ saved, now }: { saved: PoAmount | null | undefined; now: PoAmount }) {
  if (!saved || !poAmountChanged(saved, now)) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="status">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        This changes the amount from <b>{formatCurrency(saved.net, "PHP")}</b> to <b>{formatCurrency(now.net, "PHP")}</b>. The voucher &amp; checks
        were already prepared for the old amount, so saving <b>sends this PO back to the Payment Approver</b> for approval — then Accounting
        prepares the voucher again.
      </span>
    </div>
  );
}
