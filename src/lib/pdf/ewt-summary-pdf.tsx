import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";
import { ewtStatus, ewtTotals, EWT_TABLE_TITLE, type EwtKind, type EwtPeriod, type EwtRow } from "@/lib/ewt-summary";

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 7.5, color: "#111" },
  company: { fontSize: 13, fontWeight: "bold", textAlign: "center" },
  title: { fontSize: 10, fontWeight: "bold", textAlign: "center", marginTop: 2 },
  meta: { fontSize: 7.5, color: "#555", textAlign: "center", marginTop: 2, marginBottom: 10 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#333", paddingVertical: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#eee", paddingVertical: 2 },
  total: { flexDirection: "row", borderTopWidth: 2, borderColor: "#000", paddingVertical: 4, marginTop: 4, fontWeight: "bold" },
  h: { fontSize: 6.5, color: "#666" },
  cDate: { width: "8%" },
  cName: { width: "17%" },
  cAddr: { width: "17%", color: "#555" },
  cTin: { width: "10%" },
  cSi: { width: "8%" },
  cGross: { width: "10%", textAlign: "right" },
  cNet: { width: "10%", textAlign: "right" },
  cEwt: { width: "8%", textAlign: "right" },
  cStatus: { width: "6%", paddingLeft: 4 },
  cPop: { width: "6%", color: "#555" },
});

const fmt = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string) => (v.trim() ? v : "—");

export function EwtSummaryPdf({ kind, period, rows }: { kind: EwtKind; period: EwtPeriod; rows: EwtRow[] }) {
  const t = ewtTotals(rows);
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.company}>{COMPANY.name}</Text>
        <Text style={s.title}>EWT SUMMARY — {EWT_TABLE_TITLE[kind]}</Text>
        <Text style={s.meta}>Generation: {period.mode === "quarter" ? "Quarterly" : "Monthly"} — {period.label}</Text>
        {rows.length === 0 ? (
          <Text style={{ textAlign: "center", color: "#555", marginTop: 20 }}>No EWT in this period.</Text>
        ) : (
          <>
            <View style={s.headRow} fixed>
              <Text style={[s.cDate, s.h]}>DATE</Text>
              <Text style={[s.cName, s.h]}>REGISTERED NAME</Text>
              <Text style={[s.cAddr, s.h]}>{kind === "supplier" ? "SUPPLIER'S ADDRESS" : "CLIENT'S ADDRESS"}</Text>
              <Text style={[s.cTin, s.h]}>TIN</Text>
              <Text style={[s.cSi, s.h]}>S.I. #</Text>
              <Text style={[s.cGross, s.h]}>GROSS TAXABLE</Text>
              <Text style={[s.cNet, s.h]}>NET OF VAT</Text>
              <Text style={[s.cEwt, s.h]}>EWT</Text>
              <Text style={[s.cStatus, s.h]}>STATUS</Text>
              <Text style={[s.cPop, s.h]}>POP</Text>
            </View>
            {rows.map((r) => (
              <View style={s.row} key={r.refKey} wrap={false}>
                <Text style={s.cDate}>{r.date}</Text>
                <Text style={s.cName}>{r.registeredName}{"\n"}{r.reference}</Text>
                <Text style={s.cAddr}>{dash(r.address)}</Text>
                <Text style={s.cTin}>{dash(r.tin)}</Text>
                <Text style={s.cSi}>{dash(r.siNumber)}</Text>
                <Text style={s.cGross}>{fmt(r.gross)}</Text>
                <Text style={s.cNet}>{fmt(r.netOfVat)}</Text>
                <Text style={s.cEwt}>{fmt(r.ewt)}</Text>
                <Text style={s.cStatus}>{ewtStatus(r)}</Text>
                <Text style={s.cPop}>{r.pop ? "Attached" : "—"}</Text>
              </View>
            ))}
            <View style={s.total} wrap={false}>
              <Text style={{ width: "60%" }}>TOTAL · {t.count} row{t.count === 1 ? "" : "s"} · {t.paid} paid, {t.unpaid} unpaid</Text>
              <Text style={s.cGross}>{fmt(t.gross)}</Text>
              <Text style={s.cNet}>{fmt(t.netOfVat)}</Text>
              <Text style={s.cEwt}>{fmt(t.ewt)}</Text>
              <Text style={{ width: "12%" }} />
            </View>
          </>
        )}
      </Page>
    </Document>
  );
}
