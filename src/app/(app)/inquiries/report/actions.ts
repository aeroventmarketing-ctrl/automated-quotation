"use server";

import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { config, COMPANY } from "@/lib/config";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { buildSalesReport, type ReportBasis } from "@/lib/sales-report";
import { SalesReportPdf } from "@/lib/pdf/sales-report-pdf";
import { formatCurrency } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email the WON sales report (PDF attached) to a recipient. */
export async function emailSalesReport(from: string, to: string, recipient: string, basis: ReportBasis = "created"): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Unauthorized." };
  const rcpt = (recipient || "").trim();
  if (!EMAIL_RE.test(rcpt)) return { ok: false, message: "Enter a valid recipient email." };
  if (!emailConfigured() || !config.followUpFromEmail) {
    return { ok: false, message: "Email isn't configured yet — set RESEND_API_KEY and FOLLOW_UP_FROM_EMAIL." };
  }

  const report = await buildSalesReport(from, to, basis);
  const buf = await renderToBuffer(React.createElement(SalesReportPdf, { report }) as React.ReactElement<DocumentProps>);
  const base64 = Buffer.from(buf).toString("base64");

  const lines = report.groups.map((g) => `• ${g.salesperson}: ${g.count} won · ${formatCurrency(g.value, report.currency)}`).join("\n");
  const text =
    `Sales Report — WON Inquiries (per Salesperson)\n${report.from} to ${report.to}\n\n` +
    (report.totals.count === 0 ? "No WON inquiries in this range." : `${lines}\n\nGrand total: ${report.totals.count} won · ${formatCurrency(report.totals.value, report.currency)} (collected ${formatCurrency(report.totals.collected, report.currency)}).`) +
    `\n\nThe full report is attached as a PDF.`;

  try {
    await sendEmail({
      from: config.followUpFromEmail,
      to: rcpt,
      subject: `${COMPANY.name} — WON Sales Report (${report.from} to ${report.to})`,
      text,
      replyTo: user.email ?? undefined,
      attachments: [{ filename: `won-sales-report-${report.from}_to_${report.to}.pdf`, content: base64 }],
    });
    return { ok: true, message: `Sent to ${rcpt}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Send failed." };
  }
}
