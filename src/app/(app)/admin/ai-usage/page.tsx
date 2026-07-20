import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getAiUsage, getAiUsageLimit, currentMonthUsage, evaluateUsageAlert } from "@/lib/ai/usage";
import { config } from "@/lib/config";
import { AiUsageLimit } from "./ai-usage-limit";

export const dynamic = "force-dynamic";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** Admin page: monthly AI (Claude) token usage for the AI features. */
export default async function AiUsagePage() {
  const viewer = await getCurrentUser();
  if (!isAdmin(viewer)) redirect("/dashboard");

  const [usage, limit, thisMonth] = await Promise.all([getAiUsage(), getAiUsageLimit(), currentMonthUsage()]);
  const alert = evaluateUsageAlert(thisMonth, limit);
  const inPrice = config.anthropicPriceInputPerM;
  const outPrice = config.anthropicPriceOutputPerM;
  const showCost = inPrice > 0 || outPrice > 0;
  const estCost = (u: { inputTokens: number; outputTokens: number }) =>
    (u.inputTokens / 1_000_000) * inPrice + (u.outputTokens / 1_000_000) * outPrice;

  const total = usage.reduce(
    (a, u) => ({ calls: a.calls + u.calls, inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens }),
    { calls: 0, inputTokens: 0, outputTokens: 0 },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">AI usage</h1>
        <p className="text-sm text-muted-foreground">
          Token usage for the AI features (receipt reading, inquiry &amp; quotation extraction), billed by Anthropic to your
          <span className="font-mono"> ANTHROPIC_API_KEY</span>. This is a usage meter recorded by the app; the Anthropic console remains the source of truth for billing.
        </p>
      </div>

      {alert.level !== "ok" && (
        <div className={`rounded-md border p-3 text-sm ${alert.level === "over" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-amber-500/40 bg-amber-500/5 text-amber-700"}`}>
          <p className="font-semibold">{alert.level === "over" ? "AI usage limit reached" : "AI usage nearing the limit"}</p>
          <ul className="mt-0.5 list-disc pl-5 text-xs">
            {alert.messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly usage alert</CardTitle></CardHeader>
        <CardContent><AiUsageLimit monthlyCalls={limit.monthlyCalls} monthlyTokens={limit.monthlyTokens} /></CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly usage</CardTitle></CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No AI calls recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">AI calls</TableHead>
                    <TableHead className="text-right">Input tokens</TableHead>
                    <TableHead className="text-right">Output tokens</TableHead>
                    {showCost && <TableHead className="text-right">Est. cost (USD)</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((u) => (
                    <TableRow key={u.month}>
                      <TableCell className="font-medium">{u.month}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(u.calls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(u.inputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(u.outputTokens)}</TableCell>
                      {showCost && <TableCell className="text-right tabular-nums">${estCost(u).toFixed(2)}</TableCell>}
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(total.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(total.inputTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(total.outputTokens)}</TableCell>
                    {showCost && <TableCell className="text-right tabular-nums">${estCost(total).toFixed(2)}</TableCell>}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
          {!showCost && (
            <p className="mt-3 text-xs text-muted-foreground">
              To show an estimated cost here, set <span className="font-mono">ANTHROPIC_PRICE_INPUT_PER_M</span> and
              <span className="font-mono"> ANTHROPIC_PRICE_OUTPUT_PER_M</span> (USD per 1M tokens, from the Anthropic console)
              in your environment.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
