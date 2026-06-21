import { writeFileSync } from "node:fs";
import { buildQuotationXlsx, type XlsxData } from "../src/lib/excel/quotation-xlsx";

const data: XlsxData = {
  quoteNumber: "2026 - AFBM00000041J",
  dateStr: "May 28, 2026",
  projectName: "LUCKY GRILLE",
  customerName: "Edu Manzano",
  vatMode: "EXCLUSIVE",
  discountPct: 0,
  vatRate: 0.12,
  preparedBy: "Reyjellan Gil",
  preparedByTitle: "Marketing Representative",
  specNote:
    "All units are made of high quality materials. Designed and built for continuous duty operation. Statically and Dynamically balanced. Without installed Inlet Safety and Outlet Safety Screen as standard. Installed with TECO TEFC Induction Motor.",
  terms:
    "1. Payment : 50% down payment, 30% before delivery of items, 20% progress billing. VAT exclusive price. We accept Cash or Dated Check. Subject for bank clearing for check payment. And other online payments\n2. Production time : 20 to 30 working days upon confirmation of P.O. & D.P. Sundays & Holidays not included.\n3. Delivery : Subject for bank clearing for check payment. Free delivery within Metro Manila.\n4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.\n5. Warranty :\na. Six (6) months on motor except damages due to power interruption, power failure, power surge and substandard motor protector, substandard electrical practice and other user negligence.\nb. One (1) year on workmanship.\nc. Three (3) months for moving parts belts, pulley, shafting & bearing.\nd. Client shall provide an overload protection device against power fluctuation.\ne. Removing or altering any stickers and labels will void warranty.\nf. No warranty for Acts of Nature.\ng. Disassembly not performed by AFBM personnel will void the warranty.\nh. Warranty can only be availed if the unit has undergone Testing and Commissioning by AFBM.\n6. Upgrade : Epoxy Enamel Paint can be upgraded to Powder Coat / Oven Baked Paint at an additional cost.\n7. Commissioning : Testing and Commissioning is compulsory and free of charge within Metro Manila.\n8. Record : Dynamic Balancing Report and Vibration Analysis Data may be requested before scheduled delivery, otherwise additional charge will apply.\n9. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.\n10. Validity : Valid for one (1) week only or please verify prevailing prices.\n11. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM, we reserve the right not to refund the payment made to cover damages for materials and manpower.\n12. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within one (1) year, AFBM reserves the right to use the product for whatever purpose at its discretion.",
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
