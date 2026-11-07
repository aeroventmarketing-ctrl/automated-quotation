/**
 * Admin → Data check.
 *
 * Runs the inherited-workflow scan with the credentials the app already holds,
 * so finding out whether an order is carrying another order's state is a click
 * rather than a database console. It reads and prints; its only writes are the
 * guarded repairs in ./actions (an inherited workflow, drifted SKUs).
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
import { auditPoSuppliers } from "@/lib/po-supplier-audit";
import { formatCurrency } from "@/lib/utils";
import { ResetInheritedButton } from "./reset-button";
import { SkuRepairButton } from "./sku-repair-button";
import { auditSkuDrift } from "@/lib/sku-drift-audit";

// Always the live picture — a cached one would be worse than none.
export const dynamic = "force-dynamic";

export default async function DataCheckPage() {
  const [{ scanned, findings }, priceAudit, supplierAudit, skuDrift] = await Promise.all([
    scanInheritedWorkflows(),
    auditPoPrices(),
    auditPoSuppliers(),
    auditSkuDrift(),
  ]);

  return (
    <div className="space-y-4">
      {/* Request lines carrying another item's SKU (lib/sku-drift-audit). */}
      <Card className={skuDrift.issues.length ? "border-amber-400" : ""}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Request lines carrying another item&apos;s SKU</CardTitle>
            {skuDrift.issues.length > 1 && <SkuRepairButton prIds={skuDrift.issues.map((i) => i.prId)} label={`Correct all ${skuDrift.issues.length}`} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            A line&apos;s SKU decides its &ldquo;in stock&rdquo; count, its catalogue price and which stock item receiving
            pre-selects. Editing a request&apos;s lines, splitting it for a second supplier, or issuing part of a line
            from stock used to leave the old codes on whatever line now sat in their place — PO-AFBM20260001051&apos;s
            DRILL BIT carried another item&apos;s code. Listed here: every line whose name is a catalogue item with a
            different code than the one stored. Correcting sets the code the name gives, on the request and its PO
            lines, and records it in the activity log. Checked {skuDrift.checked} request{skuDrift.checked === 1 ? "" : "s"}.
          </p>
          {skuDrift.issues.length === 0 ? (
            <div className="flex items-center gap-3"><Badge variant="success">Clear</Badge><span>Every stored SKU matches its line.</span></div>
          ) : (
            <ul className="divide-y rounded-md border">
              {skuDrift.issues.map((i) => (
                <li key={i.prId} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={i.href} className="font-medium text-primary hover:underline">{i.label}</Link>
                      {i.poNumber && <span className="ml-2 font-mono text-xs">{i.poNumber}</span>}
                      <span className="ml-2 text-xs text-muted-foreground">{i.status}</span>
                    </span>
                    <SkuRepairButton prIds={[i.prId]} label="Correct" />
                  </div>
                  {[...i.fixes.map((f) => ({ k: `r${f.line}`, what: f.item, from: f.from, to: f.to, po: false })), ...i.poFixes.map((f) => ({ k: `p${f.line}`, what: f.description, from: f.from, to: f.to, po: true }))].map((f) => (
                    <div key={f.k} className="text-xs text-muted-foreground">
                      {f.po ? "PO line · " : ""}<span className="text-foreground">{f.what}</span> — stored <span className="font-mono text-destructive">{f.from}</span>, its name is <span className="font-mono text-emerald-700">{f.to}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
                      ) : i.kind === "unit_mismatch" ? (
                        <>
                          <Badge variant="secondary">Different unit</Badge>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            The PO is priced per <b>{i.poUnit || "—"}</b> and the catalogue per{" "}
                            <b>{i.productUnit || "—"}</b>, so the two figures are not comparable.
                            Probably fine — worth a glance only if the unit itself is wrong.
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

      <Card className="mt-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Purchase order suppliers vs the product catalogue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Until recently the PO form chose a line&apos;s product by scoring the <b>whole line</b>,
            specification and all. A VAV line carrying <i>Duct Diameter: 250 mm (10 in)</i> handed
            the numbers 250 and 10 to the matcher as though they were model codes, and an unrelated
            product carrying both could outrank the product actually named at the front of the line.
            The wrong product means the wrong supplier — and because exactly one eligible supplier is
            what makes the form fill itself in, and filling in overwrites every unit price, it meant
            the wrong <b>amounts</b> too.
          </p>
          <p>
            New purchase orders are matched correctly now. These are the ones already issued, which
            nothing re-checks. Read {supplierAudit.purchaseOrders} purchase order
            {supplierAudit.purchaseOrders === 1 ? "" : "s"}.
          </p>
          <p className="text-xs">
            <b>
              Buying from a supplier the catalogue doesn&apos;t list is an ordinary thing to do — a
              one-off, a stock-out, a better price, a supplier added to Products only later. A row
              here means the catalogue and the PO disagree about who sells this, which is worth a
              look. It is not a verdict.
            </b>
          </p>
        </CardContent>
      </Card>

      {supplierAudit.issues.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Badge variant="success">Clear</Badge>
            <p className="text-sm">
              Every purchase order names a supplier the catalogue lists for what it buys.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">PO</th>
                  <th className="px-4 py-3">On the PO</th>
                  <th className="px-4 py-3">The catalogue says</th>
                  <th className="px-4 py-3 text-right">PO value</th>
                  <th className="px-4 py-3 text-right">At catalogue prices</th>
                </tr>
              </thead>
              <tbody>
                {supplierAudit.issues.map((i) => (
                  <tr key={i.requestId} className="border-b last:border-0 align-top">
                    <td className="px-4 py-3">
                      {i.orderId ? (
                        <Link href={`/orders/${i.orderId}`} className="font-mono text-xs hover:underline">
                          {i.poNumber}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{i.poNumber}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {i.date}
                        {i.members > 1 && <> · combined, {i.members} requests</>}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-destructive">{i.supplier || "—"}</td>
                    <td className="px-4 py-3">
                      {i.carriers.join(", ")}
                      <span className="block text-xs text-muted-foreground">
                        from {i.matchedLines} of {i.totalLines} line
                        {i.totalLines === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCurrency(i.poTotal)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {i.catalogueTotal === null ? (
                        <span className="text-xs text-muted-foreground">
                          not priced
                          <span className="block">for every line</span>
                        </span>
                      ) : (
                        <>
                          {formatCurrency(i.catalogueTotal)}
                          {/* In words, not a sign: `formatCurrency` renders a
                              negative as "₱-234,668.86", with the minus stranded
                              after the symbol, and which way round the gap runs
                              is the whole point of the column. */}
                          <span className="block text-xs text-muted-foreground">
                            {formatCurrency(Math.abs(i.catalogueTotal - i.poTotal))}{" "}
                            {i.catalogueTotal > i.poTotal ? "more than the PO" : "less than the PO"}
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
