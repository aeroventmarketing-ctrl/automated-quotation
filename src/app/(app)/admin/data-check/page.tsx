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

// Always the live picture — a cached one would be worse than none.
export const dynamic = "force-dynamic";

export default async function DataCheckPage() {
  const { scanned, findings } = await scanInheritedWorkflows();

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
                      {f.stamps.length} approval stamp{f.stamps.length === 1 ? "" : "s"} predate this
                      quotation
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
                      {f.foreignPaths.length} document read
                      {f.foreignPaths.length === 1 ? "" : "s"} point at another order&apos;s files
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
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
