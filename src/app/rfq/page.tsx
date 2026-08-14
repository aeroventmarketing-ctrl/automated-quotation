import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { COMPANY } from "@/lib/config";
import { verifyRfqToken } from "@/lib/rfq-link";
import { RfqForm, type RfqPrefill } from "./rfq-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request a Quotation — Aerovent Fans & Blowers",
  description: "Send us your RFQ and our team will prepare a quotation for you.",
};

/**
 * Public "Request a Quotation" landing — the marketing CTA points here. A client
 * (not logged in) fills the form and uploads their RFQ; the submission lands in
 * the Inbound RFQ review queue. When the link carries a valid ?c/&t prefill token
 * (added per-recipient by the campaign), the form pre-fills that client's details.
 */
export default async function RfqPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; t?: string }>;
}) {
  const { c = "", t = "" } = await searchParams;
  const prefill: RfqPrefill = {};
  if (c && t && verifyRfqToken(c, t)) {
    const cust = await prisma.customer
      .findUnique({ where: { id: c }, select: { company: true, contactName: true, email: true } })
      .catch(() => null);
    if (cust) {
      prefill.c = c;
      prefill.t = t;
      prefill.company = cust.company ?? "";
      prefill.contactName = cust.contactName ?? "";
      prefill.email = cust.email ?? "";
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#eef2f6", fontFamily: "Arial, Helvetica, sans-serif", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 640, margin: "0 auto", background: "#fff", borderRadius: 12, padding: "28px 28px 26px", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
        <div style={{ color: "#0b5c8f", fontWeight: 700, fontSize: 15 }}>{COMPANY.name}</div>
        <div style={{ color: "#607080", fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", marginTop: 2 }}>{COMPANY.tagline}</div>
        <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "16px 0" }} />
        <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "#1f2933" }}>Request a Quotation</h1>
        <p style={{ color: "#607080", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>
          Tell us what you need and attach your RFQ, drawings or specs. Our engineering team will review it and get back
          to you with a quotation. No account needed.
        </p>
        <RfqForm prefill={prefill} />
        <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "22px 0 14px" }} />
        <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7 }}>
          Prefer email or phone? {COMPANY.email} · {COMPANY.landline}
        </div>
      </div>
    </div>
  );
}
