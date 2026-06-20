import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";

export interface QuotationPdfData {
  quoteNumber: string;
  createdAt: string;
  validUntil: string | null;
  currency: string;
  customer: {
    company: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  preparedBy: string;
  approvedBy?: string | null;
  status: string;
  notes?: string | null;
  terms?: string | null;
  items: Array<{
    descriptionSnapshot: string;
    specsSnapshot?: Record<string, unknown> | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    selectionNote?: string | null;
  }>;
  subtotal: number;
  vat: number;
  vatRate: number;
  total: number;
  template: {
    name: string;
    layoutKey: string;
    config: Record<string, unknown>;
  };
}

function money(value: number, currency: string) {
  const symbol = currency === "PHP" ? "P" : currency === "USD" ? "$" : "";
  return `${symbol}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function QuotationPdf({ data }: { data: QuotationPdfData }) {
  const cfg = data.template.config || {};
  const accent = (cfg.accent as string) || "#1d4ed8";
  const showSpecs = cfg.showSpecs !== false;
  const showSelectionNotes = cfg.showSelectionNotes === true;
  const budgetary = cfg.budgetary === true;
  const showAbcNote = cfg.showAbcNote === true;

  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `2 solid ${accent}`, paddingBottom: 10, marginBottom: 12 },
    company: { fontSize: 15, fontWeight: 700, color: accent },
    tagline: { fontSize: 8, color: "#6b7280", marginTop: 2 },
    contact: { fontSize: 8, color: "#6b7280", marginTop: 2 },
    title: { fontSize: 18, fontWeight: 700, textAlign: "right" },
    metaRight: { fontSize: 9, textAlign: "right", marginTop: 2 },
    section: { marginBottom: 10 },
    sectionLabel: { fontSize: 8, color: "#6b7280", marginBottom: 2, textTransform: "uppercase" },
    twoCol: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
    box: { width: "48%" },
    tableHead: { flexDirection: "row", backgroundColor: accent, color: "#fff", paddingVertical: 5, paddingHorizontal: 4 },
    row: { flexDirection: "row", borderBottom: "1 solid #e5e7eb", paddingVertical: 5, paddingHorizontal: 4 },
    cNo: { width: "5%" },
    cDesc: { width: "55%" },
    cQty: { width: "10%", textAlign: "right" },
    cUnit: { width: "15%", textAlign: "right" },
    cTotal: { width: "15%", textAlign: "right" },
    spec: { fontSize: 7.5, color: "#6b7280", marginTop: 2 },
    totals: { marginTop: 10, alignSelf: "flex-end", width: "40%" },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
    grandTotal: { flexDirection: "row", justifyContent: "space-between", borderTop: `1 solid ${accent}`, paddingTop: 4, marginTop: 2, fontSize: 12, fontWeight: 700 },
    terms: { marginTop: 18, fontSize: 8, color: "#374151" },
    footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 7, color: "#9ca3af", textAlign: "center", borderTop: "1 solid #e5e7eb", paddingTop: 6 },
    watermark: { position: "absolute", top: 200, left: 120, fontSize: 60, color: "#f3f4f6", transform: "rotate(-30deg)" },
    note: { fontSize: 8, marginTop: 6, padding: 6, backgroundColor: "#f9fafb" },
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {data.status !== "SENT" && <Text style={styles.watermark}>{data.status}</Text>}

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.company}>{COMPANY.name}</Text>
            <Text style={styles.tagline}>{COMPANY.tagline}</Text>
            <Text style={styles.contact}>{COMPANY.address}</Text>
            <Text style={styles.contact}>{COMPANY.email} · {COMPANY.phone}</Text>
          </View>
          <View>
            <Text style={styles.title}>{budgetary ? "BUDGETARY QUOTE" : "QUOTATION"}</Text>
            <Text style={styles.metaRight}>No. {data.quoteNumber}</Text>
            <Text style={styles.metaRight}>Date: {data.createdAt}</Text>
            {data.validUntil && <Text style={styles.metaRight}>Valid until: {data.validUntil}</Text>}
            <Text style={styles.metaRight}>Template: {data.template.name}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.box}>
            <Text style={styles.sectionLabel}>Bill to</Text>
            <Text style={{ fontWeight: 700 }}>{data.customer.company}</Text>
            {data.customer.contactName && <Text>{data.customer.contactName}</Text>}
            {data.customer.address && <Text>{data.customer.address}</Text>}
            {data.customer.email && <Text>{data.customer.email}</Text>}
            {data.customer.phone && <Text>{data.customer.phone}</Text>}
          </View>
          <View style={styles.box}>
            <Text style={styles.sectionLabel}>Prepared by</Text>
            <Text>{data.preparedBy}</Text>
            {data.approvedBy && <Text style={{ marginTop: 4 }}>Approved by: {data.approvedBy}</Text>}
          </View>
        </View>

        {showAbcNote && (
          <Text style={styles.note}>
            This quotation is submitted for procurement evaluation. Prices are inclusive of applicable
            taxes. Bidder/supplier: {COMPANY.name}.
          </Text>
        )}

        {/* Items table */}
        <View style={styles.tableHead}>
          <Text style={styles.cNo}>#</Text>
          <Text style={styles.cDesc}>Description</Text>
          <Text style={styles.cQty}>Qty</Text>
          <Text style={styles.cUnit}>Unit Price</Text>
          <Text style={styles.cTotal}>Amount</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.cNo}>{i + 1}</Text>
            <View style={styles.cDesc}>
              <Text>{it.descriptionSnapshot}</Text>
              {showSpecs && it.specsSnapshot?.requirement != null && (
                <Text style={styles.spec}>{summarizeSpecs(it.specsSnapshot)}</Text>
              )}
              {showSelectionNotes && it.selectionNote && (
                <Text style={styles.spec}>Selection: {it.selectionNote}</Text>
              )}
            </View>
            <Text style={styles.cQty}>{it.qty}</Text>
            <Text style={styles.cUnit}>{money(it.unitPrice, data.currency)}</Text>
            <Text style={styles.cTotal}>{money(it.lineTotal, data.currency)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(data.subtotal, data.currency)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>VAT ({Math.round(data.vatRate * 100)}%)</Text>
            <Text>{money(data.vat, data.currency)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>TOTAL ({data.currency})</Text>
            <Text>{money(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.notes && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        {data.terms && (
          <View style={styles.terms}>
            <Text style={styles.sectionLabel}>Terms &amp; Conditions</Text>
            <Text>{data.terms}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          {COMPANY.name} — {COMPANY.tagline}. This is a computer-generated quotation.
        </Text>
      </Page>
    </Document>
  );
}

function summarizeSpecs(specs: Record<string, unknown>): string {
  const req = specs.requirement as Record<string, unknown> | undefined;
  const sel = specs.selection as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (req) {
    if (req.airflow != null) parts.push(`Airflow ${req.airflow} ${req.airflowUnit ?? ""}`.trim());
    if (req.staticPressure != null) parts.push(`SP ${req.staticPressure} ${req.pressureUnit ?? ""}`.trim());
    if (req.application) parts.push(String(req.application));
  }
  if (sel) {
    if (sel.rpm) parts.push(`${sel.rpm} rpm`);
    if (sel.motorKw) parts.push(`${sel.motorKw} kW (${sel.motorHp} HP) motor`);
  }
  return parts.join(" · ");
}
