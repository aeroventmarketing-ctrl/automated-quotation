import { writeFileSync } from "node:fs";
import { buildQuotationXlsx, type XlsxData } from "../src/lib/excel/quotation-xlsx";

const data: XlsxData = {
  quoteNumber: "2026 - AFBM00000041J",
  dateStr: "May 28, 2026",
  projectName: "LUCKY GRILLE",
  customerName: "Edu Manzano",
  vatMode: "EXCLUSIVE",
  discountPct: 3,
  vatRate: 0.12,
  preparedBy: "Reyjellan Gil",
  specNote:
    "All units are made of high quality materials. Designed and built for continuous duty operation. Statically and Dynamically balanced. Without installed Inlet Safety and Outlet Safety Screen as standard. Installed with TECO TEFC Induction Motor.",
  terms:
    "1. Payment : 50% down payment, 30% before delivery of items, 20% progress billing. VAT exclusive price.\n2. Production time : 20 to 30 working days upon confirmation of P.O. & D.P.\n10. Validity : Valid for one (1) week only or please verify prevailing prices.",
  items: [
    { itemLabel: "1", descriptionSnapshot: "Centrifugal Blower\nImpeller Type / Belt Driven\nMade of Black Iron Sheet\nModel: AV...", qty: 1, unitPrice: 122819.2, lineTotal: 122819.2, capacity_cfm: 15320, staticPressure_inwg: 1.5, inches: 36.5, motorHp: "7.5", motorPh: 3, motorVolts: 220 },
    { itemLabel: "2", descriptionSnapshot: "Blower Platform", qty: 1, unitPrice: 16800, lineTotal: 16800 },
    { itemLabel: "3", descriptionSnapshot: "Vibration Isolator\nFoot Mounted", qty: 6, unitPrice: 1724.8, lineTotal: 10348.8 },
  ],
  total: 149968,
};

async function main() {
  const buf = await buildQuotationXlsx(data);
  writeFileSync("/tmp/test.xlsx", buf);
  console.log("wrote /tmp/test.xlsx", buf.length, "bytes");
}
main();
