import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { AEROVENT_LOGO } from "./logo";
import type { FansJobOrder } from "@/lib/job-order";
import type { JobOrderComputed } from "@/lib/job-order-compute";

export interface JobOrderPdfData {
  joNumber: string;
  jo: FansJobOrder;
  computed: JobOrderComputed;
  /** Discharge/rotation reference chart as a data URL (optional). */
  referenceImage?: string | null;
}

const S = StyleSheet.create({
  page: { paddingHorizontal: 36, paddingTop: 18, paddingBottom: 24, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  logo: { width: "100%", marginBottom: 6 },
  title: { textAlign: "center", fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 2, marginBottom: 6 },
  box: { borderWidth: 1, borderColor: "#111" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#111" },
  rowLast: { flexDirection: "row" },
  cell: { paddingVertical: 3, paddingHorizontal: 5 },
  cellBorder: { borderRightWidth: 1, borderColor: "#111" },
  label: { fontFamily: "Helvetica-Bold" },
  half: { width: "50%" },
  sectionHead: { backgroundColor: "#eee", fontFamily: "Helvetica-Bold", paddingVertical: 2, paddingHorizontal: 5, borderBottomWidth: 1, borderColor: "#111" },
  refWrap: { marginTop: 10, alignItems: "center" },
  refImg: { width: 460 },
  refCaption: { fontSize: 7, color: "#555", marginTop: 2 },
});

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

/** One "Label : value" line. */
function LineItem({ label, value, flex = 1 }: { label: string; value: string; flex?: number }) {
  return (
    <View style={{ flexDirection: "row", flex }}>
      <Text style={[S.label, { width: 74 }]}>{label}</Text>
      <Text>: {value}</Text>
    </View>
  );
}

export function JobOrderPdf({ data }: { data: JobOrderPdfData }) {
  const { jo, computed: c, joNumber } = data;
  const driveMotor = [
    c.motorHpNum && `${c.motorHpNum} HP`,
    c.motorPhase && `${c.motorPhase} PH`,
    jo.voltage && `${jo.voltage} V`,
    jo.frequency && `${jo.frequency} Hz`,
    c.motorPole && `${c.motorPole} pole`,
    c.motorRpm && `${c.motorRpm} rpm`,
    jo.mounting,
    jo.motorBrand,
    jo.enclosure,
  ].filter(Boolean).join(", ");
  const motorPulley = c.motorShaftDia
    ? `${jo.motorPulley}"Ø x ${c.pulleyBelt} x ${c.motorShaftDia} mm Ø bore x ${c.motorKeyway} mm keyway  —  ${c.motorPulleyHub} mm Ø Hub`
    : "";
  const fanPulley = jo.fanPulley
    ? `${jo.fanPulley}"Ø x ${c.pulleyBelt} x ${c.bore}  —  ${c.fanPulleyHub} mm Ø Hub`
    : "";

  return (
    <Document>
      <Page size="LETTER" style={S.page}>
        <Image style={S.logo} src={AEROVENT_LOGO} />
        <Text style={S.title}>JOB ORDER</Text>

        <View style={S.box}>
          <View style={S.row}>
            <View style={[S.cell, S.cellBorder, S.half]}><LineItem label="JOB ORDER #" value={joNumber} /></View>
            <View style={[S.cell, S.half]}><LineItem label="Date" value={fmtDate(jo.date)} /></View>
          </View>
          <View style={S.row}>
            <View style={S.cell}>
              <Text><Text style={S.label}>Project </Text>: {[jo.quantity && `${jo.quantity} ${jo.uom}`, jo.bladeDiameter && `${jo.bladeDiameter}"Ø`, jo.project, jo.make && `(${jo.make})`].filter(Boolean).join("  ")}</Text>
            </View>
          </View>
          <View style={S.rowLast}>
            <View style={[S.cell, S.cellBorder, { width: "40%" }]}><LineItem label="Target Date" value={fmtDate(jo.targetDate)} /></View>
            <View style={[S.cell, S.cellBorder, { width: "30%" }]}><LineItem label="Date Started" value="" /></View>
            <View style={[S.cell, { width: "30%" }]}><LineItem label="Date Finished" value="" /></View>
          </View>
        </View>

        <View style={[S.box, { marginTop: 6 }]}>
          <Text style={S.sectionHead}>PRODUCTION LEAD TIME</Text>
          <View style={S.rowLast}>
            <View style={[S.cell, S.cellBorder, S.half]}><LineItem label="Body" value={jo.bodyLeadTime ? `${jo.bodyLeadTime} days` : ""} /></View>
            <View style={[S.cell, S.half]}><LineItem label="Blade" value={jo.bladeLeadTime ? `${jo.bladeLeadTime} days` : ""} /></View>
          </View>
        </View>

        <View style={[S.box, { marginTop: 6 }]}>
          <View style={S.row}>
            <View style={[S.cell, S.cellBorder, S.half]}><LineItem label="Orientation" value={jo.orientation} /></View>
            <View style={[S.cell, S.half]}><LineItem label="Impeller" value={jo.bladeType} /></View>
          </View>
          <View style={S.row}>
            <View style={[S.cell, S.cellBorder, S.half]}><LineItem label="Rotation" value={jo.rotation} /></View>
            <View style={[S.cell, S.half]}><LineItem label="Drive" value={jo.driveType} /></View>
          </View>
          <View style={S.row}><View style={S.cell}><LineItem label="Capacity" value={[jo.capacity, jo.capacityAt0].filter(Boolean).join("     ")} /></View></View>
          <View style={S.row}><View style={S.cell}><LineItem label="Speed" value={[jo.rpmCatalogue && `${jo.rpmCatalogue} rpm`, c.computedFanRpm && `${c.computedFanRpm} rpm`].filter(Boolean).join("     ")} /></View></View>
          <View style={S.row}><View style={S.cell}><LineItem label="Drive Motor" value={driveMotor} /></View></View>
          <View style={S.row}><View style={S.cell}><LineItem label="Motor Pulley" value={motorPulley} /></View></View>
          <View style={S.row}><View style={S.cell}><LineItem label="Fan Pulley" value={fanPulley} /></View></View>
          <View style={S.row}><View style={S.cell}><LineItem label="Hub" value={c.hub} /></View></View>
          <View style={S.row}><View style={S.cell}><LineItem label="Shafting" value={c.shafting} /></View></View>
          <View style={S.rowLast}><View style={S.cell}><LineItem label="Bearing" value={[c.bearing, c.bearingQty && `${c.bearingQty} pcs`].filter(Boolean).join("  —  ")} /></View></View>
        </View>

        {data.referenceImage && (
          <View style={S.refWrap}>
            <Image style={S.refImg} src={data.referenceImage} />
            <Text style={S.refCaption}>Direction of rotation &amp; discharge reference (AMCA)</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
