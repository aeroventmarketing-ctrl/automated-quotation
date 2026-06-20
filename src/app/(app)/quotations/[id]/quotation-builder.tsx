"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QuotationStatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/utils";
import { config } from "@/lib/config";
import { Download, Send, Check, CornerUpLeft } from "lucide-react";
import { updateQuotationLines, transitionQuotation } from "../actions";

interface Line {
  id: string;
  descriptionSnapshot: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  selectionNote: string | null;
}
interface Quote {
  id: string;
  quoteNumber: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SENT";
  currency: string;
  subtotal: number;
  vat: number;
  total: number;
  notes: string | null;
  terms: string | null;
  validUntil: string;
  templateId: string;
  templateName: string;
  customer: string;
  preparedBy: string;
  approvedBy: string | null;
  items: Line[];
}

export function QuotationBuilder({
  quotation,
  templates,
  canApprove,
}: {
  quotation: Quote;
  templates: { id: string; name: string }[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const editable = quotation.status === "DRAFT";

  const [lines, setLines] = useState<Line[]>(quotation.items);
  const [templateId, setTemplateId] = useState(quotation.templateId);
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [terms, setTerms] = useState(quotation.terms ?? "Prices valid for 30 days. Delivery 4–6 weeks ex-works. VAT inclusive as shown.");
  const [validUntil, setValidUntil] = useState(quotation.validUntil);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const vatRate = config.vatRate;
  const totals = useMemo(() => {
    const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
    const vat = subtotal * vatRate;
    return { subtotal, vat, total: subtotal + vat };
  }, [lines, vatRate]);

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await updateQuotationLines(
        quotation.id,
        lines.map((l) => ({
          id: l.id,
          descriptionSnapshot: l.descriptionSnapshot,
          qty: l.qty,
          unitPrice: l.unitPrice,
          selectionNote: l.selectionNote,
        })),
        { templateId, notes, terms, validUntil: validUntil || undefined },
      );
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: string) {
    setBusy(true);
    setMsg(null);
    try {
      await transitionQuotation(quotation.id, to);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{quotation.quoteNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {quotation.customer} · prepared by {quotation.preparedBy}
            {quotation.approvedBy ? ` · approved by ${quotation.approvedBy}` : ""}
          </p>
        </div>
        <QuotationStatusBadge status={quotation.status} />
      </div>

      {/* Workflow + exports */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
          {quotation.status === "DRAFT" && (
            <Button onClick={() => transition("PENDING_APPROVAL")} disabled={busy}>
              <Send className="h-4 w-4" /> Submit for approval
            </Button>
          )}
          {quotation.status === "PENDING_APPROVAL" && (
            <>
              <Button onClick={() => transition("APPROVED")} disabled={busy || !canApprove} title={canApprove ? "" : "Engineer/Admin only"}>
                <Check className="h-4 w-4" /> Approve
              </Button>
              <Button variant="outline" onClick={() => transition("DRAFT")} disabled={busy}>
                <CornerUpLeft className="h-4 w-4" /> Return to draft
              </Button>
              {!canApprove && (
                <span className="text-xs text-muted-foreground">Approval requires Engineer/Admin.</span>
              )}
            </>
          )}
          {quotation.status === "APPROVED" && (
            <Button onClick={() => transition("SENT")} disabled={busy}>
              <Send className="h-4 w-4" /> Mark as sent
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/quotations/${quotation.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" /> Download PDF
              </a>
            </Button>
            {quotation.status === "SENT" && (
              <Button
                variant="outline"
                onClick={() => {
                  const link = `${window.location.origin}/q/${quotation.id}`;
                  navigator.clipboard?.writeText(link);
                  setMsg("Shareable link copied to clipboard.");
                }}
              >
                Copy share link
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {/* Line items */}
      <Card>
        <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {editable ? (
                      <div className="space-y-1">
                        <Input value={l.descriptionSnapshot} onChange={(e) => updateLine(l.id, { descriptionSnapshot: e.target.value })} />
                        <Textarea
                          rows={1}
                          className="text-xs"
                          placeholder="Selection / engineering note"
                          value={l.selectionNote ?? ""}
                          onChange={(e) => updateLine(l.id, { selectionNote: e.target.value })}
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium">{l.descriptionSnapshot}</div>
                        {l.selectionNote && <div className="text-xs text-muted-foreground">{l.selectionNote}</div>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Input
                        type="number"
                        min={1}
                        className="w-20 text-right"
                        value={l.qty}
                        onChange={(e) => updateLine(l.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                      />
                    ) : (
                      l.qty
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Input
                        type="number"
                        step="0.01"
                        className="w-32 text-right"
                        value={l.unitPrice}
                        onChange={(e) => updateLine(l.id, { unitPrice: Number(e.target.value) || 0 })}
                      />
                    ) : (
                      formatCurrency(l.unitPrice, quotation.currency)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(l.qty * l.unitPrice, quotation.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals.subtotal, quotation.currency)}</span></div>
              <div className="flex justify-between"><span>VAT ({Math.round(vatRate * 100)}%)</span><span>{formatCurrency(totals.vat, quotation.currency)}</span></div>
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{formatCurrency(totals.total, quotation.currency)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meta */}
      <Card>
        <CardHeader><CardTitle>Quotation details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Template</Label>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={!editable}>
              {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Valid until</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={!editable} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} rows={2} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Terms &amp; conditions</Label>
            <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!editable} rows={3} />
          </div>
        </CardContent>
      </Card>

      {editable && (
        <Button onClick={save} disabled={busy} size="lg">
          {busy ? "Saving…" : "Save changes"}
        </Button>
      )}
    </div>
  );
}
