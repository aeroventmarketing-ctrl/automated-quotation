/**
 * Admin → Data check.
 *
 * Runs the inherited-workflow scan with the credentials the app already holds,
 * so finding out whether an order is carrying another order's state is a click
 * rather than a database console. READ ONLY: this page reads and prints, and has
 * no action that could change an order.
 *
 * The detection lives in src/lib/inherited-workflow-scan.ts, shared with
 * scripts/scan-inherited-workflows.ts so the two can never disagree.
 */
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { scanInheritedWorkflows } from "@/lib/inherited-workflow-scan";
import { auditPoPrices } from "@/lib/po-price-audit";
import { formatCurrency } from "@/lib/utils";
import { ResetInheritedButton } from "./reset-button";

// Always the live picture — a cached one would be worse than none.
export const dynamic = "force-dynamic";

export default async function DataCheckPage() {
  const [{ scanned, findings }, priceAudit] = await Promise.all([
    scanInheritedWorkflows(),
    auditPoPrices(),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Orders carrying another order&apos;s state</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            When a quotation is duplicated, the copy can inherit the original&apos;s order workflow —
            its stage, approval stamps, job orders and closing documents — so the new order can look
            finished before any work has happened on it.
          </p>
          <p>
            Two things are checked, and neither can be true of a clean order. An approval{" "}
            <b>dated before the quotation existed</b> cannot be that order&apos;s own work. And a
            document read pointing at <b>another order&apos;s files</b> came from that other order.
          </p>
          <p className="text-xs">
            Reading only — nothing on this page changes an order. Scanned {scanned} quotation
            {scanned === 1 ? "" : "s"}.
          </p>
        </CardContent>
      </Card>

      {findings.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Badge variant="success">Clear</Badge>
            <p className="text-sm">
              No order is carrying state from another order. Nothing to repair.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm font-medium">
            {findings.length} order{findings.length === 1 ? "" : "s"} affected
          </p>

          {findings.map((f) => (
            <Card key={f.quotationId} className="border-destructive/40">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    <Link href={`/orders/${f.quotationId}`} className="hover:underline">
                      {f.quoteNumber}
                    </Link>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{f.status}</Badge>
                    <Badge variant="destructive">stage: {f.stage}</Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{f.company}</p>
              </CardHeader>

              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Created {formatDateTime(f.createdAt)}
                  {f.duplicatedFrom && <> · duplicated from <b>{f.duplicatedFrom}</b></>}
                </p>

                {f.stamps.length > 0 && (
                  <div>
                    <p className="font-medium">
                      {f.stamps.length} of {f.totalStamps} recorded step
                      {f.totalStamps === 1 ? "" : "s"} predate this quotation
                    </p>
                    {/* The whole diagnosis in one line: everything inherited means
                        the order never ran its own workflow; a few inherited out
                        of many means it was worked properly but started ahead. */}
                    <p className="text-xs text-muted-foreground">
                      {f.stamps.length === f.totalStamps
                        ? "Every recorded step came from the other order — this order has done none of its own."
                        : `The remaining ${f.totalStamps - f.stamps.length} happened after this order was created, so they are its own work.`}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {f.stamps.slice(0, 10).map((s) => (
                        <li key={s.where} className="font-mono">
                          {formatDateTime(s.at)} — {s.where}
                        </li>
                      ))}
                      {f.stamps.length > 10 && <li>…and {f.stamps.length - 10} more</li>}
                    </ul>
                  </div>
                )}

                {f.foreignPaths.length > 0 && (
                  <div>
                    <p className="font-medium">
                      {f.foreignPaths.length === 1
                        ? "1 document read points at another order's files"
                        : `${f.foreignPaths.length} document reads point at another order's files`}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {f.foreignPaths.slice(0, 10).map((p) => (
                        <li key={p.field + p.path} className="break-all font-mono">
                          {p.field}: {p.path}
                        </li>
                      ))}
                      {f.foreignPaths.length > 10 && <li>…and {f.foreignPaths.length - 10} more</li>}
                    </ul>
                  </div>
                )}

                {/* Offered only when the order has done none of its own work.
                    An order that inherited one step and then ran the rest
                    legitimately must be left alone — clearing it would destroy
                    real production and delivery records. */}
                {f.totalStamps > 0 && f.stamps.length === f.totalStamps ? (
                  <ResetInheritedButton
                    quotationId={f.quotationId}
                    quoteNumber={f.quoteNumber}
                    stamps={f.stamps.length}
                    paths={f.foreignPaths.length}
                  />
                ) : (
                  <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    No reset offered. This order did {f.totalStamps - f.stamps.length} of its own
                    workflow step{f.totalStamps - f.stamps.length === 1 ? "" : "s"}, so clearing it
                    would destroy real work. What it wrongly inherited is the early approval above —
                    that step shows another order&apos;s approver and date, and was never actually
                    performed here.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      )}

      <Card className="mt-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Purchase order prices vs the product catalogue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            A PO line&apos;s price is filled in from the catalogue when the line is blank or the
            supplier is picked. After that, <b>nothing checks it again</b> — not saving, not
            approval, not printing, not the voucher. A figure typed by hand, or one filled in when
            the catalogue said something different, travels untouched to a signed voucher. This is
            that missing check, run after the fact.
          </p>
          <p className="text-xs">
            Reading only. Checked {priceAudit.lines} priced line
            {priceAudit.lines === 1 ? "" : "s"} across {priceAudit.purchaseOrders} purchase order
            {priceAudit.purchaseOrders === 1 ? "" : "s"}.{" "}
            <b>
              A PO records the price agreed at the time, so a difference can be history rather than
              an error — check the date before treating one as wrong.
            </b>
          </p>
        </CardContent>
      </Card>

      {priceAudit.issues.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Badge variant="success">Clear</Badge>
            <p className="text-sm">Every PO line matches a price its supplier lists.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">PO</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3 text-right">On the PO</th>
                  <th className="px-4 py-3 text-right">Supplier lists</th>
                  <th className="px-4 py-3 text-right">Line total</th>
                  <th className="px-4 py-3">Why flagged</th>
                </tr>
              </thead>
              <tbody>
                {priceAudit.issues.map((i, n) => (
                  <tr key={`${i.requestId}-${n}`} className="border-b last:border-0 align-top">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{i.poNumber}</span>
                      <span className="block text-xs text-muted-foreground">{i.supplier || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      {i.description}
                      <span className="block text-xs text-muted-foreground">Qty {i.qty}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-destructive">
                      {formatCurrency(i.poPrice)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {i.supplierPrice !== null
                        ? formatCurrency(i.supplierPrice)
                        : i.allSupplierPrices.length
                          ? i.allSupplierPrices.map((p) => formatCurrency(p)).join(" / ")
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCurrency(i.poLineTotal)}
                      {i.correctedLineTotal !== null && !Number.isNaN(i.correctedLineTotal) && (
                        <span className="block text-xs text-muted-foreground">
                          would be {formatCurrency(i.correctedLineTotal)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {i.kind === "inventory_cost" ? (
                        <>
                          <Badge variant="destructive">Inventory cost</Badge>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Matches the stock unit cost ({formatCurrency(i.stockCost ?? 0)}), which
                            no supplier lists — so it was priced from inventory, not from a quote.
                          </span>
                        </>
                      ) : (
                        <>
                          <Badge variant="warning">Differs</Badge>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Not a price any supplier lists for this product.
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
