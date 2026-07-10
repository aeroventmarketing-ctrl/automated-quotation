import Link from "next/link";
import { Copy } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { QuotationStatusBadge } from "@/components/status-badge";
import type { QuotationStatus } from "@prisma/client";
import type { DuplicateMatch } from "@/lib/quote-duplicates";

/**
 * "Similar quotes" panel — shown on a quote that has an IDENTICAL line-item set
 * (same products/specs/quantities) already quoted elsewhere, so sales can reuse
 * it instead of re-quoting. Rendered only when there is at least one match.
 */
export function SimilarQuotes({ matches, currentCompany }: { matches: DuplicateMatch[]; currentCompany: string }) {
  if (!matches.length) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <Copy className="h-4 w-4" />
        {matches.length} existing quote{matches.length > 1 ? "s have" : " has"} the same items
      </div>
      <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-400/80">
        These quotes contain the identical products, specs, and quantities — reuse one instead of re-quoting.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 pr-4 font-medium">Quote #</th>
              <th className="pb-1 pr-4 font-medium">Client</th>
              <th className="pb-1 pr-4 font-medium">Prepared by</th>
              <th className="pb-1 pr-4 font-medium text-right">Total</th>
              <th className="pb-1 pr-4 font-medium">Date</th>
              <th className="pb-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className="border-t border-amber-200/70 dark:border-amber-900/40">
                <td className="py-1.5 pr-4">
                  <Link href={`/quotations/${m.id}`} className="font-medium hover:underline">{m.quoteNumber}</Link>
                </td>
                <td className="py-1.5 pr-4">
                  <Link href={`/customers/${m.customerId}`} className="hover:underline">{m.company}</Link>
                  {m.company !== currentCompany && (
                    <span className="ml-1 rounded bg-amber-200/70 px-1 text-[10px] text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                      different client
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4">{m.preparedBy}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{formatCurrency(m.total, m.currency)}</td>
                <td className="py-1.5 pr-4">{formatDate(new Date(m.createdISO))}</td>
                <td className="py-1.5"><QuotationStatusBadge status={m.status as QuotationStatus} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
