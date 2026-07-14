import Link from "next/link";
import { Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { evaluateFollowUp, sentAtFrom, nudgesSentFrom } from "@/lib/follow-up";
import { getFollowUpSettings } from "@/lib/follow-up-settings";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);

const num = (v: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v);

/**
 * "Follow-ups due" — the Sales/CRM daily worklist. It runs the follow-up rules
 * engine over every sent-but-open quote and lists the ones due for a nudge.
 *
 * DRY RUN: this page only *recommends* follow-ups; automatic sending is not
 * enabled yet, so nothing goes to any client from here. Each row links to the
 * quote and the shareable client link so a salesperson can follow up by hand.
 */
export default async function FollowUpsPage() {
  const now = new Date();
  const settings = await getFollowUpSettings();

  // Sent quotes whose inquiry is still open (not won/lost).
  const quotes = await prisma.quotation.findMany({
    where: { status: "SENT", inquiry: { status: { notIn: ["WON", "LOST"] } } },
    include: { inquiry: { include: { customer: true } }, preparedBy: true },
    orderBy: { createdAt: "asc" },
  });

  const rows = quotes
    .map((q) => {
      const sentIso = sentAtFrom(q.classification);
      const sentAt = sentIso ? new Date(sentIso) : q.createdAt;
      const result = evaluateFollowUp(
        {
          sentAt,
          validUntil: q.validUntil ?? null,
          won: false, // WON/LOST inquiries are already filtered out
          nudgesSent: nudgesSentFrom(q.classification),
          now,
        },
        settings,
      );
      return { q, sentAt, result };
    })
    .filter((r) => r.result.state === "due")
    .sort((a, b) => b.result.daysSinceSent - a.result.daysSinceSent);

  const cadence = settings.offsetsDays.join(", ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Follow-ups due</h1>
          <p className="text-sm text-muted-foreground">
            Clients to chase today — sent quotes that haven&apos;t been won yet.
          </p>
        </div>
        <Badge variant="secondary" className="h-fit">
          {rows.length} due
        </Badge>
      </div>

      {/* Dry-run notice: nothing is sent automatically yet. */}
      <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Dry run — nothing is sent automatically.</span>{" "}
          This list recommends who to follow up, on a day&nbsp;{cadence} cadence after a quote is sent
          (max {settings.maxNudges} nudges), and stops once a deal is won or the quote expires.
          Automatic sending gets switched on later, once the email channel is connected.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No follow-ups due right now. 🎉
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Quote</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead>Nudge</TableHead>
                    <TableHead>Sales</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ q, sentAt, result }) => {
                    const c = q.inquiry.customer;
                    const shareUrl = `${config.appUrl}/q/${q.id}`;
                    return (
                      <TableRow key={q.id}>
                        <TableCell>
                          <div className="font-medium">{c.company}</div>
                          {c.contactName && (
                            <div className="text-xs text-muted-foreground">{c.contactName}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {c.email ? <div>{c.email}</div> : null}
                          {c.phone ? <div className="text-muted-foreground">{c.phone}</div> : null}
                          {!c.email && !c.phone && (
                            <span className="text-muted-foreground">No contact on file</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link href={`/quotations/${q.id}`} className="font-medium text-primary hover:underline">
                            {q.quoteNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{num(Number(q.total))}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{fmtDate(sentAt)}</TableCell>
                        <TableCell className="text-right tabular-nums">{result.daysSinceSent}</TableCell>
                        <TableCell>
                          <Badge variant={result.nudgeNumber >= settings.maxNudges ? "destructive" : "default"}>
                            #{result.nudgeNumber}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{q.preparedBy.name}</TableCell>
                        <TableCell className="text-right">
                          <a
                            href={shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline"
                          >
                            View quote
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
