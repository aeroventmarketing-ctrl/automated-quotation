import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";
import type { ExpView, ExpGroupKey } from "@/lib/expenses-view";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, color: "#111" },
  company: { fontSize: 13, fontWeight: "bold", textAlign: "center" },
  title: { fontSize: 9, fontWeight: "bold", textAlign: "center", marginTop: 2 },
  meta: { fontSize: 7, color: "#555", textAlign: "center", marginTop: 2, marginBottom: 10 },
  groupHead: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#333", paddingBottom: 2, marginTop: 8, marginBottom: 2 },
  groupName: { fontSize: 9, fontWeight: "bold" },
  count: { fontSize: 7, color: "#555" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#eee", paddingVertical: 1.5 },
  headRow: { flexDirection: "row", paddingVertical: 2 },
  sub: { flexDirection: "row", borderTopWidth: 1, borderColor: "#999", paddingVertical: 2, fontWeight: "bold" },
  grand: { flexDirection: "row", borderTopWidth: 2, borderColor: "#000", paddingVertical: 4, marginTop: 8, fontWeight: "bold" },
  h: { fontSize: 7, color: "#666" },
  cDate: { width: "10%" },
  cSrc: { width: "12%" },
  cRef: { width: "17%" },
  cDept: { width: "14%" },
  cWho: { width: "16%" },
  cDetail: { width: "18%" },
  cAmt: { width: "13%", textAlign: "right" },
});

const fmt = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const GROUP_LABEL: Record<ExpGroupKey, string> = { none: "None", dept: "Department", source: "Source", month: "Month" };

export function ExpensesReportPdf({ view, from, to, group }: { view: ExpView; from: string; to: string; group: ExpGroupKey }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.company}>{COMPANY.name}</Text>
        <Text style={s.title}>Expenses Records</Text>
        <Text style={s.meta}>{from} to {to} · {view.count} record{view.count === 1 ? "" : "s"}{group !== "none" ? ` · grouped by ${GROUP_LABEL[group]}` : ""}</Text>

        {view.count === 0 ? (
          <Text style={{ textAlign: "center", color: "#555", marginTop: 20 }}>No expenses recorded in this range.</Text>
        ) : (
          <>
            {view.groups.map((g, gi) => (
              <View key={g.key || `g${gi}`}>
                {group !== "none" && (
                  <View style={s.groupHead}>
                    <Text style={s.groupName}>{g.key || "—"}</Text>
                    <Text style={s.count}>{g.rows.length} · {fmt(g.subtotal)}</Text>
                  </View>
                )}
                <View style={s.headRow}>
                  <Text style={[s.cDate, s.h]}>Date</Text>
                  <Text style={[s.cSrc, s.h]}>Source</Text>
                  <Text style={[s.cRef, s.h]}>Reference</Text>
                  <Text style={[s.cDept, s.h]}>Department</Text>
                  <Text style={[s.cWho, s.h]}>Who</Text>
                  <Text style={[s.cDetail, s.h]}>Detail</Text>
                  <Text style={[s.cAmt, s.h]}>Amount</Text>
                </View>
                {g.rows.map((r) => (
                  <View style={s.row} key={r.id} wrap={false}>
                    <Text style={s.cDate}>{r.date}</Text>
                    <Text style={s.cSrc}>{r.source}</Text>
                    <Text style={s.cRef}>{r.ref}</Text>
                    <Text style={s.cDept}>{r.deptLabel}</Text>
                    <Text style={s.cWho}>{r.who}</Text>
                    <Text style={s.cDetail}>{r.detail}</Text>
                    <Text style={s.cAmt}>{fmt(r.amount)}</Text>
                  </View>
                ))}
                {group !== "none" && (
                  <View style={s.sub}>
                    <Text style={{ width: "69%" }}>Subtotal · {g.key || "—"}</Text>
                    <Text style={{ width: "18%" }}> </Text>
                    <Text style={s.cAmt}>{fmt(g.subtotal)}</Text>
                  </View>
                )}
              </View>
            ))}
            <View style={s.grand}>
              <Text style={{ width: "69%" }}>GRAND TOTAL · {view.count} record{view.count === 1 ? "" : "s"}</Text>
              <Text style={{ width: "18%" }}> </Text>
              <Text style={s.cAmt}>{fmt(view.total)}</Text>
            </View>
          </>
        )}
      </Page>
    </Document>
  );
}
