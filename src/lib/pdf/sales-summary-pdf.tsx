import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";
import type { SalesSummary } from "@/lib/sales-summary";

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, color: "#111" },
  company: { fontSize: 13, fontWeight: "bold", textAlign: "center" },
  title: { fontSize: 9, fontWeight: "bold", textAlign: "center", marginTop: 2 },
  meta: { fontSize: 7, color: "#555", textAlign: "center", marginTop: 2, marginBottom: 10 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#333", paddingVertical: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#eee", paddingVertical: 2 },
  grand: { flexDirection: "row", borderTopWidth: 2, borderColor: "#000", paddingVertical: 4, marginTop: 4, fontWeight: "bold" },
  h: { fontSize: 7, color: "#666" },
  cDate: { width: "9%" },
  cSi: { width: "9%" },
  cCr: { width: "8%" },
  cDr: { width: "8%" },
  cCompany: { width: "20%" },
  cTin: { width: "12%" },
  cPo: { width: "11%", textAlign: "right" },
  cEwt: { width: "9%", textAlign: "right" },
  cAddr: { width: "14%", color: "#555" },
});

const fmt = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);
const dash = (v: string) => (v.trim() ? v : "—");

export function SalesSummaryPdf({ report }: { report: SalesSummary }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.company}>{COMPANY.name}</Text>
        <Text style={s.title}>Sales Summary (Vatable)</Text>
        <Text style={s.meta}>{report.from} to {report.to} · by Payment date</Text>

        {report.totals.count === 0 ? (
          <Text style={{ textAlign: "center", color: "#555", marginTop: 20 }}>No vatable sales in this date range.</Text>
        ) : (
          <>
            <View style={s.headRow}>
              <Text style={[s.cDate, s.h]}>Date</Text>
              <Text style={[s.cSi, s.h]}>SI Number</Text>
              <Text style={[s.cCr, s.h]}>CR</Text>
              <Text style={[s.cDr, s.h]}>DR</Text>
              <Text style={[s.cCompany, s.h]}>Company</Text>
              <Text style={[s.cTin, s.h]}>TIN Number</Text>
              <Text style={[s.cPo, s.h]}>P.O. Amount</Text>
              <Text style={[s.cEwt, s.h]}>EWT FP</Text>
              <Text style={[s.cAddr, s.h]}>Company Address</Text>
            </View>
            {report.rows.map((r) => (
              <View style={s.row} key={r.quotationId} wrap={false}>
                <Text style={s.cDate}>{day(r.dateISO)}</Text>
                <Text style={s.cSi}>{dash(r.siNumber)}</Text>
                <Text style={s.cCr}>{dash(r.crNumber)}</Text>
                <Text style={s.cDr}>{dash(r.drNumber)}</Text>
                <Text style={s.cCompany}>{r.company}</Text>
                <Text style={s.cTin}>{dash(r.tin)}</Text>
                <Text style={s.cPo}>{fmt(r.poAmount)}</Text>
                <Text style={s.cEwt}>{fmt(r.ewt)}</Text>
                <Text style={s.cAddr}>{dash(r.address)}</Text>
              </View>
            ))}
            <View style={s.grand}>
              <Text style={{ width: "54%" }}>GRAND TOTAL · {report.totals.count} sale{report.totals.count === 1 ? "" : "s"}</Text>
              <Text style={s.cPo}>{fmt(report.totals.poAmount)}</Text>
              <Text style={s.cEwt}>{fmt(report.totals.ewt)}</Text>
              <Text style={s.cAddr}> </Text>
            </View>
          </>
        )}
      </Page>
    </Document>
  );
}
