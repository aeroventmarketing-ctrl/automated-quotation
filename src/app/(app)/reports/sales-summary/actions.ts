"use server";

import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { config, COMPANY } from "@/lib/config";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { buildSalesSummary } from "@/lib/sales-summary";
import { SalesSummaryPdf } from "@/lib/pdf/sales-summary-pdf";
import { formatCurrency } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email the Sales Summary (Vatable) report (PDF attached) to a recipient. */
export async function emailSalesSummary(from: string, to: string, recipient: string): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Unauthorized." };
  const rcpt = (recipient || "").trim();
  if (!EMAIL_RE.test(rcpt)) return { ok: false, message: "Enter a valid recipient email." };
  if (!emailConfigured() || !config.followUpFromEmail) {
    return { ok: false, message: "Email isn't configured yet — set RESEND_API_KEY and FOLLOW_UP_FROM_EMAIL." };
  }

  const report = await buildSalesSummary(from, to);
  const buf = await renderToBuffer(React.createElement(SalesSummaryPdf, { report }) as React.ReactElement<DocumentProps>);
  const base64 = Buffer.from(buf).toString("base64");

  const text =
    `Sales Summary (Vatable)\n${report.from} to ${report.to} · by Payment date\n\n` +
    (report.totals.count === 0
      ? "No vatable sales in this range."
      : `${report.totals.count} sale(s) · P.O. total ${formatCurrency(report.totals.poAmount, report.currency)} · EWT ${formatCurrency(report.totals.ewt, report.currency)}.`) +
    `\n\nThe full report is attached as a PDF.`;

  try {
    await sendEmail({
      from: config.followUpFromEmail,
      to: rcpt,
      subject: `${COMPANY.name} — Sales Summary (Vatable) (${report.from} to ${report.to})`,
      text,
      replyTo: user.email ?? undefined,
      attachments: [{ filename: `sales-summary-vatable-${report.from}_to_${report.to}.pdf`, content: base64 }],
    });
    return { ok: true, message: `Sent to ${rcpt}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Send failed." };
  }
}
