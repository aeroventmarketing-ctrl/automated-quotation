import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";
import type { SalesReport } from "@/lib/sales-report";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, color: "#111" },
  company: { fontSize: 13, fontWeight: "bold", textAlign: "center" },
  title: { fontSize: 9, fontWeight: "bold", textAlign: "center", marginTop: 2 },
  meta: { fontSize: 7, color: "#555", textAlign: "center", marginTop: 2, marginBottom: 10 },
  groupHead: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#333", paddingBottom: 2, marginTop: 8, marginBottom: 2 },
  person: { fontSize: 9, fontWeight: "bold" },
  count: { fontSize: 7, color: "#555" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#eee", paddingVertical: 1.5 },
  headRow: { flexDirection: "row", paddingVertical: 2 },
  sub: { flexDirection: "row", borderTopWidth: 1, borderColor: "#999", paddingVertical: 2, fontWeight: "bold" },
  grand: { flexDirection: "row", borderTopWidth: 2, borderColor: "#000", paddingVertical: 4, marginTop: 8, fontWeight: "bold" },
  h: { fontSize: 7, color: "#666" },
  cDate: { width: "13%" },
  cCust: { width: "31%" },
  cSrc: { width: "12%", color: "#555" },
  cQ: { width: "8%", textAlign: "center" },
  cV: { width: "12%", textAlign: "right" },
  cC: { width: "12%", textAlign: "right" },
  cB: { width: "12%", textAlign: "right" },
});

const fmt = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);

export function SalesReportPdf({ report }: { report: SalesReport }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.company}>{COMPANY.name}</Text>
        <Text style={s.title}>Sales Report — WON Inquiries (per Salesperson)</Text>
        <Text style={s.meta}>{report.from} to {report.to}</Text>

        {report.totals.count === 0 ? (
          <Text style={{ textAlign: "center", color: "#555", marginTop: 20 }}>No WON inquiries in this date range.</Text>
        ) : (
          <>
            {report.groups.map((g) => (
              <View key={g.salesperson} wrap={false}>
                <View style={s.groupHead}>
                  <Text style={s.person}>{g.salesperson}</Text>
                  <Text style={s.count}>{g.count} won</Text>
                </View>
                <View style={s.headRow}>
                  <Text style={[s.cDate, s.h]}>Date</Text>
                  <Text style={[s.cCust, s.h]}>Customer</Text>
                  <Text style={[s.cSrc, s.h]}>Source</Text>
                  <Text style={[s.cQ, s.h]}>Quotes</Text>
                  <Text style={[s.cV, s.h]}>Value</Text>
                  <Text style={[s.cC, s.h]}>Collected</Text>
                  <Text style={[s.cB, s.h]}>Balance</Text>
                </View>
                {g.rows.map((r) => (
                  <View style={s.row} key={r.inquiryId}>
                    <Text style={s.cDate}>{day(r.dateISO)}</Text>
                    <Text style={s.cCust}>{r.company}</Text>
                    <Text style={s.cSrc}>{r.source}</Text>
                    <Text style={s.cQ}>{r.quotes}</Text>
                    <Text style={s.cV}>{fmt(r.value)}</Text>
                    <Text style={s.cC}>{fmt(r.collected)}</Text>
                    <Text style={s.cB}>{fmt(r.balance)}</Text>
                  </View>
                ))}
                <View style={s.sub}>
                  <Text style={{ width: "64%" }}>Subtotal · {g.salesperson}</Text>
                  <Text style={s.cV}>{fmt(g.value)}</Text>
                  <Text style={s.cC}>{fmt(g.collected)}</Text>
                  <Text style={s.cB}>{fmt(g.balance)}</Text>
                </View>
              </View>
            ))}
            <View style={s.grand}>
              <Text style={{ width: "64%" }}>GRAND TOTAL · {report.totals.count} won</Text>
              <Text style={s.cV}>{fmt(report.totals.value)}</Text>
              <Text style={s.cC}>{fmt(report.totals.collected)}</Text>
              <Text style={s.cB}>{fmt(report.totals.balance)}</Text>
            </View>
          </>
        )}
      </Page>
    </Document>
  );
}
