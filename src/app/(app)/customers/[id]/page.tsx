import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InquiryStatusBadge, QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { saleFromClassification, isSaleConfirmed, collectedTotal, ARRANGEMENT_LABEL } from "@/lib/sale";
import { payableTotal } from "@/lib/quote";
import { Plus } from "lucide-react";
import { getAccountData, currentOwner, type AccountAssignment } from "@/lib/account";
import { addQuotation } from "../actions";
import { CustomerHeader } from "./customer-header";
import { AccountPanel } from "./account-panel";
import { ConversationPanel, type ConversationBoxData } from "./conversation-panel";

export const dynamic = "force-dynamic";

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, viewer, users, accountData] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        inquiries: {
          orderBy: { createdAt: "desc" },
          include: {
            createdBy: true,
            _count: { select: { items: true, quotations: true } },
            quotations: {
              orderBy: { createdAt: "desc" },
              include: { preparedBy: true },
            },
          },
        },
      },
    }),
    getCurrentUser(),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getAccountData(id),
  ]);

  if (!customer) notFound();

  // Flatten every quotation across the customer's inquiries into an order/quote
  // history, tagging each with its sale state (confirmed order + collected).
  const quotes = customer.inquiries
    .flatMap((inq) =>
      inq.quotations.map((q) => {
        const sale = saleFromClassification(q.classification);
        return {
          id: q.id,
          quoteNumber: q.quoteNumber,
          createdAt: q.createdAt,
          status: q.status,
          total: Number(q.total),
          // The true deal value: gross after discount + VAT presentation, so a
          // revised (discounted) quote updates the order/purchase amounts.
          deal: payableTotal(q),
          currency: q.currency,
          preparedByName: q.preparedBy.name,
          projectName: q.projectName ?? inq.projectName ?? "",
          confirmed: isSaleConfirmed(sale),
          collected: collectedTotal(sale),
          arrangement: sale?.arrangement ?? null,
        };
      }),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const orders = quotes.filter((q) => q.confirmed);
  const purchaseAmount = orders.reduce((a, q) => a + q.deal, 0);
  const collectedAmount = orders.reduce((a, q) => a + q.collected, 0);
  const currency = quotes[0]?.currency ?? "PHP";

  // Account ownership ("sales in-charge") + transfer history. When the account
  // was never explicitly assigned/transferred, derive the initial owner from the
  // earliest inquiry's creator (starting from that inquiry's date) so the panel
  // still shows who currently holds it and since when.
  const earliestInquiry = customer.inquiries.length
    ? customer.inquiries.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
    : null;
  const derivedInitial: AccountAssignment | null = earliestInquiry
    ? {
        userId: earliestInquiry.createdById,
        name: earliestInquiry.createdBy.name,
        startedAt: earliestInquiry.createdAt.toISOString(),
        endedAt: null,
      }
    : null;
  const historyEntries: AccountAssignment[] =
    accountData?.history?.length ? accountData.history : derivedInitial ? [derivedInitial] : [];
  const owner = (accountData ? currentOwner(accountData) : null) ?? derivedInitial;
  const ownerName = owner?.name ?? null;
  // The current sales in-charge, or an admin, may transfer the account.
  const canTransfer = isAdmin(viewer) || (!!owner && owner.userId === viewer?.id);
  const salespeople = users.filter((u) => u.id !== owner?.userId);

  // Conversation log split into one box per quotation. Each conversation is
  // filed under the quote it relates to; anything without a matching quote (or
  // logged before this split) collects in a "General" box.
  const conversations = accountData?.conversations ?? [];
  const toView = (c: (typeof conversations)[number]) => ({
    id: c.id,
    date: c.date,
    channel: c.channel,
    contactPerson: c.contactPerson,
    message: c.message,
    quoteNumber: c.quoteNumber,
    nextFollowUp: c.nextFollowUp,
    loggedById: c.loggedById,
    loggedByName: c.loggedByName,
    createdAt: c.createdAt,
  });
  const quoteNumbers = new Set(quotes.map((q) => q.quoteNumber));
  const conversationBoxes: ConversationBoxData[] = quotes.map((q) => ({
    quoteNumber: q.quoteNumber,
    label: q.quoteNumber,
    conversations: conversations.filter((c) => c.quoteNumber === q.quoteNumber).map(toView),
  }));
  const generalConversations = conversations.filter((c) => !c.quoteNumber || !quoteNumbers.has(c.quoteNumber));
  if (generalConversations.length > 0 || conversationBoxes.length === 0) {
    conversationBoxes.push({
      quoteNumber: null,
      label: "General (no quotation)",
      conversations: generalConversations.map(toView),
    });
  }

  const detail = (label: string, value: string | null | undefined) => (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value?.trim() ? value : "—"}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <CustomerHeader
        customer={{
          id: customer.id,
          company: customer.company,
          contactName: customer.contactName ?? "",
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          address: customer.address ?? "",
          notes: customer.notes ?? "",
        }}
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Purchase amount</div>
            <div className="text-2xl font-bold">{formatCurrency(purchaseAmount, currency)}</div>
            <div className="text-xs text-muted-foreground">{orders.length} confirmed order{orders.length === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Amount collected</div>
            <div className="text-2xl font-bold">{formatCurrency(collectedAmount, currency)}</div>
            <div className="text-xs text-muted-foreground">
              {purchaseAmount > 0 ? `${Math.round((collectedAmount / purchaseAmount) * 100)}% of orders` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Inquiries</div>
            <div className="text-2xl font-bold">{customer.inquiries.length}</div>
            <div className="text-xs text-muted-foreground">total received</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Quotations</div>
            <div className="text-2xl font-bold">{quotes.length}</div>
            <div className="text-xs text-muted-foreground">prepared</div>
          </CardContent>
        </Card>
      </div>

      {/* Client detail + sales in-charge */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Client details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {detail("Company", customer.company)}
            {detail("Contact person", customer.contactName)}
            {detail("Contact number", customer.phone)}
            {detail("Email", customer.email)}
            <div className="sm:col-span-2">{detail("Address", customer.address)}</div>
            {customer.notes && <div className="sm:col-span-2">{detail("Notes", customer.notes)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sales in-charge</CardTitle></CardHeader>
          <CardContent>
            <AccountPanel
              customerId={customer.id}
              currentOwnerName={ownerName}
              history={historyEntries.map((h) => ({ name: h.name, startedAt: h.startedAt, endedAt: h.endedAt }))}
              salespeople={salespeople}
              canTransfer={canTransfer}
            />
          </CardContent>
        </Card>
      </div>

      {/* Order history (confirmed sales) */}
      <Card>
        <CardHeader><CardTitle>Order history</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Arrangement</TableHead>
                <TableHead className="text-right">Order amount</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">{q.quoteNumber}</Link>
                  </TableCell>
                  <TableCell>{q.projectName || "—"}</TableCell>
                  <TableCell>{q.arrangement ? ARRANGEMENT_LABEL[q.arrangement] : "—"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(q.deal, q.currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(q.collected, q.currency)}</TableCell>
                  <TableCell>{formatDate(q.createdAt)}</TableCell>
                </TableRow>
              ))}
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">No confirmed orders yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quotation history (all quotes) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Quotation history</CardTitle>
          <form action={addQuotation.bind(null, customer.id)}>
            <Button type="submit" size="sm">
              <Plus className="h-4 w-4" />
              Add quotation
            </Button>
          </form>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Prepared by</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <Link href={`/quotations/${q.id}`} className="font-medium hover:underline">{q.quoteNumber}</Link>
                  </TableCell>
                  <TableCell>{q.preparedByName}</TableCell>
                  <TableCell className="text-right">{formatCurrency(q.total, q.currency)}</TableCell>
                  <TableCell>{formatDate(q.createdAt)}</TableCell>
                  <TableCell><QuotationStatusBadge status={q.status} /></TableCell>
                </TableRow>
              ))}
              {quotes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No quotations yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Inquiry history */}
      <Card>
        <CardHeader><CardTitle>Inquiry history</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Quotes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customer.inquiries.map((inq) => (
                <TableRow key={inq.id}>
                  <TableCell>
                    <Link href={`/inquiries/${inq.id}`} className="font-medium hover:underline">
                      {inq.projectName?.trim() ? inq.projectName : "(no project name)"}
                    </Link>
                  </TableCell>
                  <TableCell>{inq.source}</TableCell>
                  <TableCell>{inq.createdBy.name}</TableCell>
                  <TableCell>{inq._count.items}</TableCell>
                  <TableCell>{inq._count.quotations}</TableCell>
                  <TableCell>{formatDate(inq.createdAt)}</TableCell>
                  <TableCell><InquiryStatusBadge status={inq.status} /></TableCell>
                </TableRow>
              ))}
              {customer.inquiries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No inquiries yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Conversation history (follow-ups) — one box per quotation */}
      <ConversationPanel
        customerId={customer.id}
        boxes={conversationBoxes}
        defaultContact={customer.contactName ?? ""}
        currentUserId={viewer?.id ?? null}
        isAdmin={isAdmin(viewer)}
      />
    </div>
  );
}
