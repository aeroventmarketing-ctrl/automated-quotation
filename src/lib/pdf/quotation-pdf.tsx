import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";
import { applyPricing, pricingForVatMode, vatDisplayBasisIsGross, round2, type PricingAdjust } from "@/lib/quote";
import { AEROVENT_LOGO } from "./logo";

export interface QuotationPdfLine {
  itemLabel: string;
  descriptionSnapshot: string; // may contain newlines
  qty: number;
  unitPrice: number; // VAT-inclusive
  lineTotal: number; // VAT-inclusive
  /** Flat VAT-inclusive line (KDK etc.) — never divided by 1.12 in exclusive mode. */
  vatExempt?: boolean;
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
  vatMode: "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS" | "ZERO_RATED";
  projectName?: string | null;
  customer: { company: string; contactName?: string | null; address?: string | null };
  preparedBy: string;
  signature?: string | null; // sales person's signature image (PNG/JPEG data URL)
  approvedBy?: string | null;
  status: string;
  specNote?: string | null;
  terms?: string | null;
  /** Motor column unit header — "Hp" for blowers, "W" for KDK units. */
  motorUnit?: string;
  /** Size column unit header — "Inches" normally, "ft" for HVLS quotes. */
  sizeUnit?: string;
  items: QuotationPdfLine[];
  subtotal: number; // net of VAT
  vat: number;
  total: number; // VAT-inclusive gross (raw line sum, before mark-up / discount)
  vatRate: number;
  /** Header mark-up / discount; folded into prices (mark-up) and shown as a line (discount). */
  pricing?: PricingAdjust | null;
  discountPct?: number; // legacy fallback when no pricing block
}

function money(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const dash = (v: number | null | undefined) => (v == null || v === 0 ? "--" : String(v));

// Column widths in points (A4 content width ≈ 539pt @ 28pt margins).
const W = { item: 26, qty: 24, desc: 150, cfm: 42, pa: 42, inch: 38, hp: 28, ph: 26, volts: 34, unit: 60, total: 69 };
const BORDER = "0.7 solid #000";

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 40, paddingHorizontal: 28, fontSize: 8, fontFamily: "Helvetica", color: "#000" },
  logo: { width: 300, height: 50, alignSelf: "center", objectFit: "contain" },
  head2: { textAlign: "center", fontSize: 10, fontWeight: 700, marginTop: 2 },
  head3: { textAlign: "center", fontSize: 7.5, fontWeight: 700, letterSpacing: 0.3 },
  addr: { textAlign: "center", fontSize: 6.5, marginTop: 0.5 },
  hr: { borderBottom: "1 solid #000", marginTop: 4, marginBottom: 6 },

  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  quoteNo: { fontSize: 9, fontWeight: 700 },
  bold: { fontWeight: 700 },
  intro: { marginTop: 4, marginBottom: 5 },

  // table
  table: { borderTop: BORDER, borderLeft: BORDER },
  row: { flexDirection: "row" },
  hCellFull: { borderRight: BORDER, borderBottom: BORDER, height: 30, justifyContent: "center", alignItems: "center", textAlign: "center", fontSize: 6.8, fontWeight: 700, paddingHorizontal: 1 },
  hGroup: { borderRight: BORDER, height: 30 },
  hGroupLabel: { borderBottom: BORDER, flexGrow: 1, justifyContent: "center", alignItems: "center", textAlign: "center", fontSize: 6.5, fontWeight: 700, paddingHorizontal: 1 },
  hGroupUnit: { height: 12, justifyContent: "center", alignItems: "center", textAlign: "center", fontSize: 6.5, fontWeight: 700 },
  hMotorTop: { borderBottom: BORDER, height: 15, justifyContent: "center", alignItems: "center", fontSize: 6.8, fontWeight: 700 },
  hMotorSub: { flexDirection: "row", height: 15 },
  hMotorCell: { justifyContent: "center", alignItems: "center", textAlign: "center", fontSize: 6.8, fontWeight: 700 },

  cell: { borderRight: BORDER, borderBottom: BORDER, justifyContent: "center", paddingVertical: 2, paddingHorizontal: 2, fontSize: 7 },
  cCenter: { alignItems: "center", textAlign: "center" },
  cLeft: { alignItems: "flex-start", textAlign: "left", justifyContent: "flex-start" },
  cRight: { alignItems: "flex-end", textAlign: "right" },

  totalRow: { flexDirection: "row" },
  totalLabel: { borderRight: BORDER, borderBottom: BORDER, textAlign: "right", fontWeight: 700, fontSize: 8, justifyContent: "center", paddingRight: 6, paddingVertical: 3 },
  totalVal: { borderRight: BORDER, borderBottom: BORDER, textAlign: "right", fontWeight: 700, fontSize: 8, justifyContent: "center", alignItems: "flex-end", paddingRight: 2, paddingVertical: 3 },

  note: { fontSize: 6.8, marginTop: 8, lineHeight: 1.3 },
  footer: { position: "absolute", bottom: 14, left: 28, right: 28, textAlign: "center", fontSize: 6, color: "#555", borderTop: "0.5 solid #aaa", paddingTop: 3 },
  watermark: { position: "absolute", top: 280, left: 150, fontSize: 64, color: "#f2f2f2", transform: "rotate(-30deg)" },
  termsTitle: { fontWeight: 700, marginBottom: 6, marginTop: 4 },
  termsBody: { fontSize: 7.5, lineHeight: 1.45 },
});

function Letterhead() {
  // `fixed` so the header + logo repeat on every physical page a <Page> spills
  // onto — the first quotation page, table-continuation pages, and the terms
  // page all carry the letterhead.
  return (
    <View fixed>
      <Image style={s.logo} src={AEROVENT_LOGO} />
      <Text style={s.head2}>FANS AND BLOWERS MANUFACTURING</Text>
      <Text style={s.head3}>VENTILATION, AIR MOVING &amp; ENGINEERING SPECIALISTS</Text>
      <Text style={s.addr}>{COMPANY.manilaOffice}</Text>
      <Text style={s.addr}>{COMPANY.landline}</Text>
      <Text style={s.addr}>{COMPANY.mobile}</Text>
      <Text style={s.addr}>{COMPANY.plantAddress}</Text>
      <Text style={s.addr}>Email: {COMPANY.email}   /   Website: {COMPANY.website}</Text>
      <View style={s.hr} />
    </View>
  );
}

function TableHeader({ motorUnit, sizeUnit }: { motorUnit?: string; sizeUnit?: string }) {
  return (
    <View style={s.row} fixed>
      <View style={[s.hCellFull, { width: W.item }]}><Text>Item</Text></View>
      <View style={[s.hCellFull, { width: W.qty }]}><Text>Qty</Text></View>
      <View style={[s.hCellFull, { width: W.desc }]}><Text>Description</Text></View>
      <View style={[s.hGroup, { width: W.cfm }]}>
        <View style={s.hGroupLabel}><Text>Capacity</Text></View>
        <View style={s.hGroupUnit}><Text>(cfm)</Text></View>
      </View>
      <View style={[s.hGroup, { width: W.pa }]}>
        <View style={s.hGroupLabel}><Text>Static{"\n"}Pressure</Text></View>
        <View style={s.hGroupUnit}><Text>(Pa)</Text></View>
      </View>
      <View style={[s.hGroup, { width: W.inch }]}>
        <View style={s.hGroupLabel}><Text>Size</Text></View>
        <View style={s.hGroupUnit}><Text>{sizeUnit || "Inches"}</Text></View>
      </View>
      <View style={[s.hGroup, { width: W.hp + W.ph + W.volts }]}>
        <View style={s.hMotorTop}><Text>MOTOR</Text></View>
        <View style={s.hMotorSub}>
          <View style={[s.hMotorCell, { width: W.hp, borderRight: BORDER }]}><Text>{motorUnit || "Hp"}</Text></View>
          <View style={[s.hMotorCell, { width: W.ph, borderRight: BORDER }]}><Text>Ph</Text></View>
          <View style={[s.hMotorCell, { width: W.volts }]}><Text>Volts</Text></View>
        </View>
      </View>
      <View style={[s.hCellFull, { width: W.unit }]}><Text>Unit{"\n"}Price</Text></View>
      <View style={[s.hCellFull, { width: W.total }]}><Text>Total{"\n"}Price</Text></View>
    </View>
  );
}

function TotalLine({ label, value, leftSpan }: { label: string; value: number; leftSpan: number }) {
  return (
    <View style={s.totalRow}>
      <View style={[s.totalLabel, { width: leftSpan }]}><Text>{label}</Text></View>
      <View style={[s.totalVal, { width: W.total }]}><Text>{money(value)}</Text></View>
    </View>
  );
}

export function QuotationPdf({ data }: { data: QuotationPdfData }) {
  const grossBasis = vatDisplayBasisIsGross(data.vatMode);
  const exclusive = !grossBasis; // net-basis presentation (÷1.12)
  const zeroRated = data.vatMode === "ZERO_RATED";
  const f = grossBasis ? 1 : 1 / (1 + data.vatRate);
  const leftSpan = W.item + W.qty + W.desc + W.cfm + W.pa + W.inch + W.hp + W.ph + W.volts + W.unit;

  // Fold the hidden mark-up into displayed prices and show the discount as its
  // own line, mirroring the Excel export so the PDF total equals what the client
  // is billed (payableTotal).
  const pricing: PricingAdjust = data.pricing ?? { markupMode: "percent", markupValue: 0, discountMode: "percent", discountValue: data.discountPct ?? 0 };
  // Flat (VAT-inclusive) lines are never divided by 1.12 — they contribute at
  // full value to the net; only the VATable lines get ÷1.12 in exclusive mode.
  const exemptTotal = round2(data.items.reduce((a, it) => a + (it.vatExempt ? it.lineTotal : 0), 0));
  const vatableTotal = round2(data.total - exemptTotal);
  const vatableBaseNet = round2(vatableTotal * f);
  const baseNet = round2(vatableBaseNet + exemptTotal);
  const adj = applyPricing(baseNet, pricingForVatMode(pricing, data.vatMode, data.vatRate));
  const markedNet = round2(adj.afterMarkup); // net incl. hidden mark-up
  const mFactor = baseNet > 0 ? markedNet / baseNet : 1;
  const displayedNet = markedNet;
  const discountAmt = round2(adj.discountAmt);
  const finalNet = round2(adj.finalNet);
  // VAT added on top (EXCLUSIVE_PLUS) applies to the VATable share only.
  const vatableShare = baseNet > 0 ? vatableBaseNet / baseNet : 0;
  const vat = round2(finalNet * vatableShare * data.vatRate);
  const hasDiscount = discountAmt > 0;
  const discountLabel = pricing.discountMode === "percent" && pricing.discountValue > 0 ? `LESS ${pricing.discountValue}% DISCOUNT =>` : "LESS DISCOUNT =>";
  const vatPct = Math.round(data.vatRate * 100);

  return (
    <Document>
      {/* Page 1 — quotation */}
      <Page size="A4" style={s.page}>
        {data.status !== "SENT" && <Text style={s.watermark} fixed>{data.status}</Text>}
        <Letterhead />

        <View style={s.metaRow}>
          <Text style={s.quoteNo}>QUOT NO. {data.quoteNumber}</Text>
          <Text>{data.createdAt}</Text>
        </View>
        {data.projectName ? (
          <Text style={{ marginTop: 2 }}><Text style={s.bold}>PROJECT : </Text>{data.projectName}</Text>
        ) : null}
        <Text style={{ marginTop: 1 }}>
          <Text style={s.bold}>TO: </Text>{data.customer.contactName || data.customer.company}
        </Text>
        <View style={s.intro}>
          <Text>Dear Sir/Ma&apos;am:</Text>
          <Text>We are pleased to quote the price for your ventilation requirements.</Text>
        </View>

        {/* Table */}
        <View style={s.table}>
          <TableHeader motorUnit={data.motorUnit} sizeUnit={data.sizeUnit} />
          {data.items.map((it, i) => (
            <View key={i} style={s.row} wrap={false}>
              <View style={[s.cell, s.cCenter, { width: W.item }]}><Text>{it.itemLabel || String(i + 1)}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.qty }]}><Text>{it.qty}</Text></View>
              <View style={[s.cell, s.cLeft, { width: W.desc }]}><Text>{it.descriptionSnapshot}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.cfm }]}><Text>{dash(it.capacity_cfm)}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.pa }]}><Text>{dash(it.staticPressure_pa)}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.inch }]}><Text>{dash(it.inches)}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.hp }]}><Text>{dash(it.motorHp)}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.ph }]}><Text>{dash(it.motorPh)}</Text></View>
              <View style={[s.cell, s.cCenter, { width: W.volts }]}><Text>{dash(it.motorVolts)}</Text></View>
              <View style={[s.cell, s.cRight, { width: W.unit }]}><Text>{money(it.unitPrice * (it.vatExempt ? 1 : f) * mFactor)}</Text></View>
              <View style={[s.cell, s.cRight, { width: W.total }]}><Text>{money(it.lineTotal * (it.vatExempt ? 1 : f) * mFactor)}</Text></View>
            </View>
          ))}

          {/* Totals — mark-up folded into prices; discount shown as its own line. */}
          {exclusive ? (
            <>
              <TotalLine leftSpan={leftSpan} label="NET AMOUNT (VAT exclusive price) =>" value={displayedNet} />
              {hasDiscount && (
                <>
                  <TotalLine leftSpan={leftSpan} label={discountLabel} value={discountAmt} />
                  <TotalLine leftSpan={leftSpan} label="NET AMOUNT =>" value={finalNet} />
                </>
              )}
              {data.vatMode === "EXCLUSIVE_PLUS" && (
                <>
                  <TotalLine leftSpan={leftSpan} label={`ADD VAT (${vatPct}%) =>`} value={vat} />
                  <TotalLine leftSpan={leftSpan} label="TOTAL AMOUNT DUE (VAT inclusive) =>" value={round2(finalNet + vat)} />
                </>
              )}
            </>
          ) : (
            <>
              <TotalLine leftSpan={leftSpan} label={zeroRated ? "NET AMOUNT (VAT zero-rated) =>" : "NET AMOUNT (VAT inclusive price) =>"} value={displayedNet} />
              {hasDiscount && (
                <>
                  <TotalLine leftSpan={leftSpan} label={discountLabel} value={discountAmt} />
                  <TotalLine leftSpan={leftSpan} label="TOTAL AMOUNT DUE =>" value={finalNet} />
                </>
              )}
            </>
          )}
        </View>

        {data.specNote ? (
          <Text style={s.note}><Text style={s.bold}>Note: </Text>{data.specNote}</Text>
        ) : null}

        <Text style={s.footer} fixed>
          {COMPANY.manilaOffice} · {COMPANY.email} · {COMPANY.website}
        </Text>
      </Page>

      {/* Page 2 — terms & conditions */}
      <Page size="A4" style={s.page}>
        <Letterhead />
        <Text style={s.termsTitle}>The above quotation is subject to the following terms and conditions:</Text>
        <Text style={s.termsBody}>{data.terms || "—"}</Text>
        <View style={{ marginTop: 16, fontSize: 8 }}>
          <Text>{COMPANY.closing}</Text>
          <Text style={{ marginTop: 14 }}>{COMPANY.signoff}</Text>
          <Text style={s.bold}>{COMPANY.name}</Text>
          {data.signature ? (
            <Image src={data.signature} style={{ width: 120, marginTop: 6, marginBottom: 2 }} />
          ) : (
            <Text style={{ marginTop: 18 }}> </Text>
          )}
          <Text>{data.preparedBy}</Text>
          <Text>{COMPANY.signatory}</Text>
        </View>
        <Text style={s.footer} fixed>
          {COMPANY.manilaOffice} · {COMPANY.email} · {COMPANY.website}
        </Text>
      </Page>
    </Document>
  );
}
