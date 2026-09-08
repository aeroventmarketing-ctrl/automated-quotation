/**
 * The check register as a PDF — the owner's *"add an option to download in excel
 * file and pdf file."*
 *
 * The same view the screen shows, printed: same tab, same search, same sort,
 * same grouping, same columns. Landscape because nine columns of a payment
 * register on portrait A4 is a wall of wrapped text.
 *
 * The Cash position rides along when the reader is one of the two it belongs to
 * — the owner's *"include cash position in the printed or downloaded file."* The
 * route decides who; this only draws it.
 */
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/config";
import type { CheckRegisterView, CheckGroupBy } from "@/lib/check-register-view";
import { CHECK_GROUP_LABEL } from "@/lib/check-register-view";
import { CHECK_EXPORT_HEADERS, checkRegisterTextRow, cashPositionLines, cashPositionNote, signedAmount } from "@/lib/check-register-export";
import type { CashPosition } from "@/lib/cash-position";

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, color: "#111" },
  company: { fontSize: 13, fontWeight: "bold", textAlign: "center" },
  title: { fontSize: 9, fontWeight: "bold", textAlign: "center", marginTop: 2 },
  meta: { fontSize: 7, color: "#555", textAlign: "center", marginTop: 2, marginBottom: 10 },
  groupHead: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#333", paddingBottom: 2, marginTop: 8, marginBottom: 2 },
  groupName: { fontSize: 9, fontWeight: "bold" },
  count: { fontSize: 7, color: "#555" },
  headRow: { flexDirection: "row", paddingVertical: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#eee", paddingVertical: 1.5 },
  sub: { flexDirection: "row", borderTopWidth: 1, borderColor: "#999", paddingVertical: 2, fontWeight: "bold" },
  grand: { flexDirection: "row", borderTopWidth: 2, borderColor: "#000", paddingVertical: 4, marginTop: 8, fontWeight: "bold" },
  h: { fontSize: 7, color: "#666" },
  foot: { position: "absolute", bottom: 12, left: 24, right: 24, fontSize: 6.5, color: "#777", textAlign: "center" },
  cashTitle: { fontSize: 10, fontWeight: "bold", marginTop: 14, marginBottom: 3 },
  cashRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5, borderBottomWidth: 0.5, borderColor: "#eee" },
  cashNote: { fontSize: 6.5, color: "#777", marginTop: 5 },
  cashBox: { width: "58%" },
});

/** Nine columns, widths chosen for what actually sits in them. */
const W = ["8%", "20%", "17%", "10%", "10%", "10%", "7%", "10%", "8%"] as const;
const RIGHT = new Set([4]); // Amount

const cell = (i: number) => ({ width: W[i], textAlign: RIGHT.has(i) ? ("right" as const) : ("left" as const), paddingRight: 3 });

const fmt = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function HeaderRow() {
  return (
    <View style={s.headRow}>
      {CHECK_EXPORT_HEADERS.map((h, i) => (
        <Text key={h} style={[cell(i), s.h]}>{h}</Text>
      ))}
    </View>
  );
}

export function CheckRegisterPdf({ view, group, todayYMD, cash }: {
  view: CheckRegisterView;
  group: CheckGroupBy;
  todayYMD: string;
  /** Omitted for a reader the panel is not for — see the route. */
  cash?: CashPosition | null;
}) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.company}>{COMPANY.name}</Text>
        <Text style={s.title}>Check monitoring</Text>
        <Text style={s.meta}>{view.caption} · as of {todayYMD}</Text>

        {view.count === 0 ? (
          <Text style={{ textAlign: "center", color: "#555", marginTop: 20 }}>Nothing to show for this arrangement.</Text>
        ) : (
          <>
            {view.groups.map((g, gi) => (
              <View key={g.key || `g${gi}`}>
                {group !== "none" && (
                  <View style={s.groupHead}>
                    <Text style={s.groupName}>{g.label || "—"}</Text>
                    <Text style={s.count}>{g.rows.length} · {fmt(g.total)}</Text>
                  </View>
                )}
                <HeaderRow />
                {g.rows.map((r, i) => (
                  <View key={`${r.prId}-${r.path}-${i}`} style={s.row} wrap={false}>
                    {checkRegisterTextRow(r).map((v, ci) => (
                      <Text key={ci} style={cell(ci)}>{v}</Text>
                    ))}
                  </View>
                ))}
                {group !== "none" && (
                  <View style={s.sub}>
                    <Text style={cell(0)}>Subtotal</Text>
                    <Text style={{ width: W[1] }}>{g.label || "—"}</Text>
                    <Text style={{ width: W[2] }} />
                    <Text style={{ width: W[3] }} />
                    <Text style={cell(4)}>{fmt(g.total)}</Text>
                  </View>
                )}
              </View>
            ))}
            <View style={s.grand}>
              <Text style={cell(0)}>TOTAL</Text>
              <Text style={{ width: W[1] }}>{view.count} check{view.count === 1 ? "" : "s"}</Text>
              <Text style={{ width: W[2] }} />
              <Text style={{ width: W[3] }} />
              <Text style={cell(4)}>{fmt(view.total)}</Text>
            </View>
          </>
        )}

        {/* The cash position, kept together on one page: half a balance sheet
            at a page break is worse than a second page. Its figures are the
            WHOLE register's, which is why the note says so — a reader holding
            the paper cannot click anything to find out. */}
        {cash && (
          <View style={s.cashBox} wrap={false}>
            <Text style={s.cashTitle}>Cash position</Text>
            {cashPositionLines(cash).map((l) => (
              <View key={l.label} style={s.cashRow}>
                <Text style={l.strong ? { fontWeight: "bold" } : undefined}>{l.label}</Text>
                <Text style={l.strong ? { fontWeight: "bold" } : undefined}>
                  {l.signed ? signedAmount(l.value) : fmt(l.value)}
                </Text>
              </View>
            ))}
            <Text style={s.cashNote}>{cashPositionNote(cash)}</Text>
          </View>
        )}

        {/* Says what the page does NOT contain, so nobody reads a filtered
            register as the whole one. */}
        <Text style={s.foot} fixed>
          Check monitoring · {view.caption} · printed {todayYMD}
        </Text>
      </Page>
    </Document>
  );
}
