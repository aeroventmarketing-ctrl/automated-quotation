import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";

export interface QuotationPdfLine {
  itemLabel: string;
  descriptionSnapshot: string; // may contain newlines
  qty: number;
  unitPrice: number; // VAT-inclusive
  lineTotal: number; // VAT-inclusive
  capacity_cfm?: number | null;
  staticPressure_pa?: number | null;
  inches?: number | null;
  motorHp?: number | null;
  motorPh?: number | null;
  motorVolts?: number | null;
}

export interface QuotationPdfData {
  quoteNumber: string;
  createdAt: string;
  validUntil: string | null;
  vatMode: "INCLUSIVE" | "EXCLUSIVE";
  projectName?: string | null;
  customer: {
    company: string;
    contactName?: string | null;
    address?: string | null;
  };
  preparedBy: string;
  approvedBy?: string | null;
  status: string;
  specNote?: string | null;
  terms?: string | null;
  items: QuotationPdfLine[];
  subtotal: number; // net of VAT
  vat: number;
  total: number; // VAT-inclusive gross
  vatRate: number;
}

function money(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
const dash = (v: number | null | undefined) =>
  v == null || v === 0 ? "--" : String(v);

const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 70, paddingHorizontal: 28, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
  // Letterhead
  letterhead: { textAlign: "center", borderBottom: "1.5 solid #0f766e", paddingBottom: 6, marginBottom: 10 },
  company: { fontSize: 13, fontWeight: 700, color: "#0f766e", letterSpacing: 0.5 },
  tagline: { fontSize: 8, fontStyle: "italic", marginTop: 1 },
  addr: { fontSize: 6.5, color: "#374151", marginTop: 1 },
  // Meta
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  quoteNo: { fontSize: 10, fontWeight: 700 },
  metaLabel: { fontWeight: 700 },
  intro: { marginTop: 6, marginBottom: 6 },
  // Table
  thead: { flexDirection: "row", backgroundColor: "#0f766e", color: "#fff", fontSize: 6.5, fontWeight: 700 },
  row: { flexDirection: "row", borderBottom: "0.5 solid #d1d5db", fontSize: 7 },
  cItem: { width: "5%", padding: 3, textAlign: "center" },
  cQty: { width: "5%", padding: 3, textAlign: "center" },
  cDesc: { width: "33%", padding: 3 },
  cCfm: { width: "8%", padding: 3, textAlign: "right" },
  cPa: { width: "7%", padding: 3, textAlign: "right" },
  cIn: { width: "7%", padding: 3, textAlign: "right" },
  cHp: { width: "5%", padding: 3, textAlign: "right" },
  cPh: { width: "5%", padding: 3, textAlign: "right" },
  cV: { width: "6%", padding: 3, textAlign: "right" },
  cUnit: { width: "7%", padding: 3, textAlign: "right" },
  cTotal: { width: "12%", padding: 3, textAlign: "right" },
  netRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  netLabel: { fontWeight: 700, fontSize: 8.5, textAlign: "right", paddingRight: 8 },
  netVal: { fontWeight: 700, fontSize: 8.5, width: "12%", textAlign: "right", borderTop: "1 solid #0f766e", paddingTop: 2 },
  note: { fontSize: 7, color: "#374151", marginTop: 10, lineHeight: 1.3 },
  // Footer letterhead (fixed on each page)
  footer: { position: "absolute", bottom: 18, left: 28, right: 28, textAlign: "center", fontSize: 6, color: "#6b7280", borderTop: "0.5 solid #d1d5db", paddingTop: 4 },
  watermark: { position: "absolute", top: 250, left: 130, fontSize: 70, color: "#f1f5f9", transform: "rotate(-32deg)" },
  // Terms page
  termsTitle: { fontWeight: 700, marginBottom: 6 },
  termsBody: { fontSize: 7.5, lineHeight: 1.4 },
  closing: { marginTop: 16, fontSize: 8 },
});

function Letterhead() {
  return (
    <View style={styles.letterhead}>
      <Text style={styles.company}>{COMPANY.name}</Text>
      <Text style={styles.tagline}>{COMPANY.tagline}</Text>
      <Text style={styles.addr}>{COMPANY.manilaOffice}</Text>
      <Text style={styles.addr}>{COMPANY.landline}</Text>
      <Text style={styles.addr}>{COMPANY.mobile}</Text>
      <Text style={styles.addr}>{COMPANY.plantAddress}</Text>
      <Text style={styles.addr}>Email: {COMPANY.email}  ·  Website: {COMPANY.website}</Text>
    </View>
  );
}

export function QuotationPdf({ data }: { data: QuotationPdfData }) {
  const exclusive = data.vatMode === "EXCLUSIVE";
  const f = exclusive ? 1 / (1 + data.vatRate) : 1; // factor to strip VAT for display

  return (
    <Document>
      {/* Page 1 — quotation */}
      <Page size="A4" style={styles.page}>
        {data.status !== "SENT" && <Text style={styles.watermark} fixed>{data.status}</Text>}
        <Letterhead />

        <View style={styles.metaRow}>
          <Text style={styles.quoteNo}>QUOT NO. {data.quoteNumber}</Text>
          <Text>{data.createdAt}</Text>
        </View>
        {data.projectName ? (
          <Text><Text style={styles.metaLabel}>PROJECT : </Text>{data.projectName}</Text>
        ) : null}
        <Text>
          <Text style={styles.metaLabel}>TO: </Text>
          {data.customer.contactName || data.customer.company}
        </Text>
        {data.customer.contactName && data.customer.company ? (
          <Text>{data.customer.company}</Text>
        ) : null}

        <View style={styles.intro}>
          <Text>Dear Sir/Ma&apos;am:</Text>
          <Text>We are pleased to quote the price for your ventilation requirements.</Text>
        </View>

        {/* Items table */}
        <View style={styles.thead}>
          <Text style={styles.cItem}>Item</Text>
          <Text style={styles.cQty}>Qty</Text>
          <Text style={styles.cDesc}>Description</Text>
          <Text style={styles.cCfm}>Capacity{"\n"}(CFM)</Text>
          <Text style={styles.cPa}>S.P.{"\n"}(Pa)</Text>
          <Text style={styles.cIn}>Size{"\n"}(in)</Text>
          <Text style={styles.cHp}>HP</Text>
          <Text style={styles.cPh}>Ph</Text>
          <Text style={styles.cV}>Volts</Text>
          <Text style={styles.cUnit}>Unit{"\n"}Price</Text>
          <Text style={styles.cTotal}>Amount</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.cItem}>{it.itemLabel || String(i + 1)}</Text>
            <Text style={styles.cQty}>{it.qty}</Text>
            <Text style={styles.cDesc}>{it.descriptionSnapshot}</Text>
            <Text style={styles.cCfm}>{dash(it.capacity_cfm)}</Text>
            <Text style={styles.cPa}>{dash(it.staticPressure_pa)}</Text>
            <Text style={styles.cIn}>{dash(it.inches)}</Text>
            <Text style={styles.cHp}>{dash(it.motorHp)}</Text>
            <Text style={styles.cPh}>{dash(it.motorPh)}</Text>
            <Text style={styles.cV}>{dash(it.motorVolts)}</Text>
            <Text style={styles.cUnit}>{money(it.unitPrice * f)}</Text>
            <Text style={styles.cTotal}>{money(it.lineTotal * f)}</Text>
          </View>
        ))}

        {/* Totals */}
        {exclusive ? (
          <>
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>VATable Sales =&gt;</Text>
              <Text style={styles.netVal}>{money(data.subtotal)}</Text>
            </View>
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>VAT ({Math.round(data.vatRate * 100)}%) =&gt;</Text>
              <Text style={styles.netVal}>{money(data.vat)}</Text>
            </View>
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>TOTAL AMOUNT DUE (VAT inclusive) =&gt;</Text>
              <Text style={styles.netVal}>{money(data.total)}</Text>
            </View>
          </>
        ) : (
          <View style={styles.netRow}>
            <Text style={styles.netLabel}>NET AMOUNT (VAT inclusive price) =&gt;</Text>
            <Text style={styles.netVal}>{money(data.total)}</Text>
          </View>
        )}

        {data.specNote ? <Text style={styles.note}>{data.specNote}</Text> : null}

        <Text style={styles.footer} fixed>
          {COMPANY.name} — {COMPANY.tagline} · {COMPANY.email} · {COMPANY.website}
        </Text>
      </Page>

      {/* Page 2 — terms & conditions */}
      <Page size="A4" style={styles.page}>
        <Letterhead />
        <Text style={styles.termsTitle}>
          The above quotation is subject to the following terms and conditions:
        </Text>
        <Text style={styles.termsBody}>{data.terms || "—"}</Text>

        <View style={styles.closing}>
          <Text>{COMPANY.closing}</Text>
          <Text style={{ marginTop: 12 }}>{COMPANY.signoff}</Text>
          <Text style={{ fontWeight: 700, marginTop: 2 }}>{COMPANY.name}</Text>
          <Text style={{ marginTop: 16 }}>{data.preparedBy}</Text>
          <Text>{COMPANY.signatory}</Text>
        </View>

        <Text style={styles.footer} fixed>
          {COMPANY.name} — {COMPANY.tagline} · {COMPANY.email} · {COMPANY.website}
        </Text>
      </Page>
    </Document>
  );
}
