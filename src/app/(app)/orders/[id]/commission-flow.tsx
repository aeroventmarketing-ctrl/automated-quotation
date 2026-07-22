"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { OrderCommissionFlow, WorkflowDoc } from "@/lib/order-workflow";
import {
  approveCommission,
  uploadCommissionVoucher,
  approveCommissionVoucher,
  releaseCommissionBudget,
  receiveCommission,
  fileSignedCommissionVoucher,
} from "../actions";

const docLink = (d: WorkflowDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docView = (d: WorkflowDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const docDownload = (d: WorkflowDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

function DocRow({ label, doc }: { label: string; doc: WorkflowDoc }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <a href={docView(doc)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
        <FileText className="h-3.5 w-3.5" /> {doc.name}
      </a>
      <a href={docView(doc)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="View" aria-label="View">
        <Eye className="h-3.5 w-3.5" />
      </a>
      <a href={docDownload(doc)} className="text-muted-foreground hover:text-primary" title="Download" aria-label="Download">
        <Download className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}

/**
 * Post-close sales-commission workflow: approve amount → upload voucher →
 * approve voucher → release budget → mark received → file signed voucher.
 */
export function CommissionFlow({
  orderId,
  amount,
  currency,
  salesMonth,
  dueLabel,
  flow,
  canApprove,
  canAccounting,
}: {
  orderId: string;
  amount: number;
  currency: string;
  salesMonth: string;
  dueLabel: string;
  flow: OrderCommissionFlow;
  canApprove: boolean;
  canAccounting: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function uploadThen(file: File, action: (doc: { path: string; name: string; uploadedAt?: string }) => Promise<void>) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("quotationId", orderId);
      const res = await fetch("/api/sale-uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await action(data);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const uploadLabel = (text: string) => (
    <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white ${busy ? "bg-primary/60" : "bg-primary hover:bg-primary/90"}`}>
      <Upload className="h-4 w-4" /> {busy ? "Uploading…" : text}
      <input type="file" className="hidden" disabled={busy}
        onChange={(e) => e.target.files?.[0] && uploadThen(e.target.files[0], text.includes("signed") ? fileSignedCommissionVoucher.bind(null, orderId) : uploadCommissionVoucher.bind(null, orderId))} />
    </label>
  );

  const awaiting = (who: string) => <p className="text-sm text-muted-foreground">Awaiting {who}.</p>;

  // Completed sign-offs trail.
  const trail = [
    flow.approvedByName && `Amount approved — ${flow.approvedByName}`,
    flow.voucherByName && `Voucher uploaded — ${flow.voucherByName}`,
    flow.voucherApprovedByName && `Voucher approved — ${flow.voucherApprovedByName}`,
    flow.budgetReleasedByName && `Budget released — ${flow.budgetReleasedByName}`,
    flow.receivedByName && `Received — ${flow.receivedByName}`,
    flow.filedByName && `Signed voucher filed — ${flow.filedByName}`,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Commission amount (1.5%)</p>
        <span className="text-sm font-semibold">{formatCurrency(amount, currency)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Sales month {salesMonth}. Issued to Sales {dueLabel ? `by ${dueLabel}` : ""} — 15 days after the sales month.
      </p>

      {trail.length > 0 && <div className="text-xs text-muted-foreground">{trail.join(" · ")}</div>}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {flow.voucherDoc && <DocRow label="Voucher" doc={flow.voucherDoc} />}
        {flow.signedVoucherDoc && <DocRow label="Signed voucher" doc={flow.signedVoucherDoc} />}
      </div>

      {/* Current actionable step */}
      {!flow.approvedAt ? (
        canApprove ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => approveCommission(orderId))}>
            {busy ? "Saving…" : "Approve Commission Amount"}
          </Button>
        ) : awaiting("an admin / the Payment Approver to approve the commission amount")
      ) : !flow.voucherAt ? (
        canAccounting ? uploadLabel("Upload Commission Voucher") : awaiting("Accounting to upload the commission voucher")
      ) : !flow.voucherApprovedAt ? (
        canApprove ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => approveCommissionVoucher(orderId))}>
            {busy ? "Saving…" : "Approve Commission Voucher"}
          </Button>
        ) : awaiting("an admin / the Payment Approver to approve the voucher")
      ) : !flow.budgetReleasedAt ? (
        canApprove ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => releaseCommissionBudget(orderId))}>
            {busy ? "Saving…" : "Release Commission Budget"}
          </Button>
        ) : awaiting("an admin / the Payment Approver to release the budget")
      ) : !flow.receivedAt ? (
        canAccounting ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => receiveCommission(orderId))}>
            {busy ? "Saving…" : "Mark commission received"}
          </Button>
        ) : awaiting("Accounting to mark the commission received")
      ) : !flow.signedVoucherDoc ? (
        canAccounting ? uploadLabel("Upload signed voucher") : awaiting("Accounting to file the signed voucher")
      ) : (
        <p className="text-sm text-emerald-600">Commission complete — signed voucher filed by {flow.filedByName}.</p>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
