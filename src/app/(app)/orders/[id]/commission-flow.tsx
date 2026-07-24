"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Download, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { OrderCommissionFlow, WorkflowDoc } from "@/lib/order-workflow";
import { workflowRoleLabel } from "@/lib/workflow-roles";
import { ApproverHighlight } from "@/components/approver-highlight";
import {
  approveCommission,
  uploadCommissionVoucher,
  approveCommissionVoucher,
  releaseCommissionBudget,
  receiveCommission,
  fileSignedCommissionVoucher,
  removeCommissionVoucher,
} from "../actions";

const docLink = (d: WorkflowDoc) => `/api/sale-uploads?path=${encodeURIComponent(d.path)}`;
const docView = (d: WorkflowDoc) => `/api/sale-uploads/view?path=${encodeURIComponent(d.path)}&name=${encodeURIComponent(d.name)}`;
const docDownload = (d: WorkflowDoc) => `${docLink(d)}&download=1&name=${encodeURIComponent(d.name)}`;

function DocRow({ label, doc, onRemove }: { label: string; doc: WorkflowDoc; onRemove?: () => void }) {
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
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive" title="Remove" aria-label="Remove">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
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
  admin = false,
  approvers = {},
}: {
  orderId: string;
  amount: number;
  currency: string;
  salesMonth: string;
  dueLabel: string;
  flow: OrderCommissionFlow;
  canApprove: boolean;
  canAccounting: boolean;
  admin?: boolean;
  approvers?: Record<string, string[]>;
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

  const awaiting = (detail: string, roleKeys: string[] = []) => {
    const names = [...new Set(roleKeys.flatMap((r) => approvers[r] ?? []))];
    const roleLabel = roleKeys.map(workflowRoleLabel).join(" / ");
    return <ApproverHighlight role={roleLabel || undefined} names={names} detail={detail} />;
  };

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
        {flow.voucherDoc && <DocRow label="Voucher" doc={flow.voucherDoc} onRemove={admin ? () => { if (window.confirm("Remove this voucher document?")) run(() => removeCommissionVoucher(orderId, "voucher")); } : undefined} />}
        {flow.signedVoucherDoc && <DocRow label="Signed voucher" doc={flow.signedVoucherDoc} onRemove={admin ? () => { if (window.confirm("Remove this signed voucher document?")) run(() => removeCommissionVoucher(orderId, "signed")); } : undefined} />}
      </div>

      {/* Current actionable step */}
      {!flow.approvedAt ? (
        canApprove ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => approveCommission(orderId))}>
            {busy ? "Saving…" : "Approve Commission Amount"}
          </Button>
        ) : awaiting("to approve the commission amount", ["payment_approver"])
      ) : !flow.voucherAt ? (
        canAccounting ? uploadLabel("Upload Commission Voucher") : awaiting("to upload the commission voucher", ["accounting"])
      ) : !flow.voucherApprovedAt ? (
        canApprove ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => approveCommissionVoucher(orderId))}>
            {busy ? "Saving…" : "Approve Commission Voucher"}
          </Button>
        ) : awaiting("to approve the voucher", ["payment_approver"])
      ) : !flow.budgetReleasedAt ? (
        canApprove ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => releaseCommissionBudget(orderId))}>
            {busy ? "Saving…" : "Release Commission Budget"}
          </Button>
        ) : awaiting("to release the budget", ["payment_approver"])
      ) : !flow.receivedAt ? (
        canAccounting ? (
          <Button size="sm" disabled={busy} onClick={() => run(() => receiveCommission(orderId))}>
            {busy ? "Saving…" : "Mark Commission Received"}
          </Button>
        ) : awaiting("to mark the commission received", ["accounting"])
      ) : !flow.signedVoucherDoc ? (
        canAccounting ? uploadLabel("Upload Signed Voucher") : awaiting("to file the signed voucher", ["accounting"])
      ) : (
        <p className="text-sm text-emerald-600">Commission complete — signed voucher filed by {flow.filedByName}.</p>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
