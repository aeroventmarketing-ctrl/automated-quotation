import { renderToFile } from "@react-pdf/renderer";
import React from "react";
import { QuotationPdf, type QuotationPdfData } from "../src/lib/pdf/quotation-pdf";

const desc = (model: string, type: string) =>
  `${type}\nImpeller Type / Belt Driven\nMade of Black iron sheet\nPainted with Epoxy Enamel Aqua Green / Model:\n${model}`;

const data: QuotationPdfData = {
  quoteNumber: "2026 - AFBM0002040J",
  createdAt: "June 19, 2026",
  validUntil: null,
  vatMode: "INCLUSIVE",
  projectName: "DG ENGINEERING & CONSTRUCTION SERVICES",
  customer: { company: "DG Engineering", contactName: "Mr. Mark De Galicia" },
  preparedBy: "AFBM Sales",
  status: "DRAFT",
  specNote:
    "All units are made of high quality materials. Designed and built for continuous duty operation. Statically and Dynamically balanced. Without installed Inlet Safety and Outlet Safety Screen as standard. Installed with TECO / TECO MONARCH / HYUNDAI TEFC Induction Motor.",
  terms: "1. Payment : 50% down payment...\n2. Production time : 25 to 30 working days...",
  items: [
    { itemLabel: "1", descriptionSnapshot: desc("AV2225CIEB5K3F4T", "Centrifugal Inline Blower"), qty: 8, unitPrice: 65854, lineTotal: 526832, capacity_cfm: 5500, staticPressure_pa: 300, inches: 22.25, motorHp: 5, motorPh: 3, motorVolts: 440 },
    { itemLabel: "1B", descriptionSnapshot: "Vibration isolator", qty: 32, unitPrice: 1663, lineTotal: 53216 },
    { itemLabel: "2", descriptionSnapshot: desc("AV2450CIEB5K3F4T", "Centrifugal Inline Blower"), qty: 3, unitPrice: 41186, lineTotal: 123558, capacity_cfm: 13300, staticPressure_pa: 125, inches: 30, motorHp: 3, motorPh: 3, motorVolts: 440 },
    { itemLabel: "3", descriptionSnapshot: desc("AV3000EWF3K3F4T", "Exhaust Wall Fan"), qty: 2, unitPrice: 68872, lineTotal: 137744, capacity_cfm: 7000, staticPressure_pa: 300, inches: 24.5, motorHp: 5, motorPh: 3, motorVolts: 440 },
    { itemLabel: "3B", descriptionSnapshot: "Vibration isolator", qty: 8, unitPrice: 1663, lineTotal: 13304 },
  ],
  subtotal: 763083.93,
  vat: 91570.07,
  total: 854654,
  vatRate: 0.12,
};

async function main() {
  await renderToFile(React.createElement(QuotationPdf, { data }) as never, "/tmp/out.pdf");
  console.log("wrote /tmp/out.pdf");
}
main();
