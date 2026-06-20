/**
 * Generates a self-contained SQL file (schema DDL + seed data) that can be run
 * in the Supabase SQL Editor — used when the DB is only reachable over HTTPS
 * (no direct Postgres port). Run: `npx tsx scripts/gen-seed-sql.ts`.
 *
 * Mirrors prisma/seed.ts. Uses explicit string ids (Prisma cuid() has no DB
 * default), and relies on DB-level defaults for createdAt/active/etc.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ddl = readFileSync(join(process.cwd(), "prisma/migrations/0001_init/migration.sql"), "utf8");

// ---- literal helpers -------------------------------------------------------
const txt = (s: string | null | undefined) =>
  s == null ? "NULL" : `$txt$${s}$txt$`;
const jsonb = (o: unknown) => `$j$${JSON.stringify(o ?? {})}$j$::jsonb`;
const num = (n: number) => String(n);

const out: string[] = [];
out.push("-- AeroQuote — schema + sample data for Supabase SQL Editor");
out.push("-- Generated from prisma/seed.ts. Run once on an empty 'public' schema.");
out.push("BEGIN;");
out.push("");
out.push("-- ============ SCHEMA ============");
out.push(ddl.trim());
out.push("");
out.push("-- ============ SEED DATA ============");

// ---- Users -----------------------------------------------------------------
out.push(`INSERT INTO "User" (id,email,name,role) VALUES
 ('usr_sales','sales@aerovent.example','Sofia Sales','SALES'),
 ('usr_engineer','engineer@aerovent.example','Eduardo Engineer','ENGINEER'),
 ('usr_admin','admin@aerovent.example','Andrea Admin','ADMIN');`);

// ---- Customers -------------------------------------------------------------
out.push(`INSERT INTO "Customer" (id,company,"contactName",email,phone,address,notes) VALUES
 ('seed-customer-a',${txt("Metro Foods Manufacturing Inc.")},${txt("Ramon Dela Cruz")},${txt("ramon@metrofoods.example")},${txt("+63 917 000 1111")},${txt("Laguna Technopark, Biñan, Laguna")},${txt("Kitchen exhaust + process ventilation. Prefers PHP quotes.")}),
 ('seed-customer-b',${txt("Department of Public Works (Regional Office)")},${txt("Engr. Liza Santos")},${txt("procurement@dpwh.example")},${txt("+63 2 8000 2222")},${txt("Quezon City, Metro Manila")},${txt("Government / BAC procurement — requires detailed line items.")});`);

// ---- Catalogue + prices ----------------------------------------------------
type Cat = {
  modelCode: string; family: string; name: string; description: string;
  sizeLabel?: string; specs: Record<string, unknown>; uom?: string;
  price: number; options?: Record<string, number>;
};
const catalogue: Cat[] = [
  { modelCode: "AX-400-D", family: "AXIAL", name: "Axial Flow Fan 400mm Direct", description: "Direct-drive wall axial fan for general ventilation.", sizeLabel: "400mm", specs: { airflow_m3hr: [1000, 6000], staticPressure_pa: [0, 250], motorHp: [0.5, 1], drive: "direct", material: "MS" }, price: 18500, options: { "Aluminum impeller": 3500, "Epoxy coating": 2200 } },
  { modelCode: "AX-630-D", family: "AXIAL", name: "Axial Flow Fan 630mm Direct", description: "High-volume axial fan for warehouses.", sizeLabel: "630mm", specs: { airflow_m3hr: [4000, 16000], staticPressure_pa: [0, 350], motorHp: [1, 3], drive: "direct", material: "MS" }, price: 34500, options: { "Aluminum impeller": 6500, "Bird screen": 1800 } },
  { modelCode: "AX-800-B", family: "AXIAL", name: "Axial Flow Fan 800mm Belt", description: "Belt-driven axial fan for high static applications.", sizeLabel: "800mm", specs: { airflow_m3hr: [8000, 30000], staticPressure_pa: [0, 500], motorHp: [3, 7.5], drive: "belt", material: "MS" }, price: 68000, options: { "VFD ready": 4500 } },
  { modelCode: "CF-355-BI", family: "CENTRIFUGAL", name: "Centrifugal Blower 355 Backward", description: "Backward-inclined centrifugal for medium pressure.", sizeLabel: "355mm", specs: { airflow_m3hr: [1500, 9000], staticPressure_pa: [200, 1500], motorHp: [1, 5], drive: "belt", material: "MS", wheel: "backward-inclined" }, price: 56000, options: { "SS304 wheel": 18000, "Inlet damper": 7500 } },
  { modelCode: "CF-450-FC", family: "CENTRIFUGAL", name: "Centrifugal Blower 450 Forward", description: "Forward-curved centrifugal for HVAC supply.", sizeLabel: "450mm", specs: { airflow_m3hr: [3000, 14000], staticPressure_pa: [150, 900], motorHp: [2, 7.5], drive: "belt", material: "MS", wheel: "forward-curved" }, price: 72000, options: { "Spark-resistant": 22000 } },
  { modelCode: "CF-560-BI", family: "CENTRIFUGAL", name: "Centrifugal Blower 560 Backward", description: "High-efficiency backward-inclined for dust collection.", sizeLabel: "560mm", specs: { airflow_m3hr: [6000, 22000], staticPressure_pa: [500, 2500], motorHp: [5, 15], drive: "belt", material: "MS", wheel: "backward-inclined" }, price: 118000, options: { "Abrasion liner": 28000, Drain: 1500 } },
  { modelCode: "CF-710-RT", family: "CENTRIFUGAL", name: "Centrifugal Blower 710 Radial", description: "Radial-tip blower for high-pressure material handling.", sizeLabel: "710mm", specs: { airflow_m3hr: [8000, 28000], staticPressure_pa: [1000, 4000], motorHp: [10, 30], drive: "belt", material: "MS", wheel: "radial" }, price: 196000 },
  { modelCode: "PR-600-W", family: "PROPELLER", name: "Wall Propeller Fan 600mm", description: "Economical wall-mount propeller exhaust fan.", sizeLabel: "600mm", specs: { airflow_m3hr: [3000, 9000], staticPressure_pa: [0, 80], motorHp: [0.5, 1], drive: "direct", material: "MS" }, price: 12500, options: { "Auto shutter": 2800 } },
  { modelCode: "PR-900-W", family: "PROPELLER", name: "Wall Propeller Fan 900mm", description: "Large wall propeller for factory exhaust.", sizeLabel: "900mm", specs: { airflow_m3hr: [9000, 24000], staticPressure_pa: [0, 100], motorHp: [1, 2], drive: "direct", material: "MS" }, price: 22000, options: { "Auto shutter": 4200 } },
  { modelCode: "TI-315", family: "TUBULAR_INLINE", name: "Tubular Inline Fan 315mm", description: "Inline duct fan for balanced ventilation.", sizeLabel: "315mm", specs: { airflow_m3hr: [800, 4000], staticPressure_pa: [50, 400], motorHp: [0.5, 1.5], drive: "direct", material: "GI" }, price: 28000 },
  { modelCode: "TI-400", family: "TUBULAR_INLINE", name: "Tubular Inline Fan 400mm", description: "Medium inline duct fan.", sizeLabel: "400mm", specs: { airflow_m3hr: [2000, 8000], staticPressure_pa: [80, 500], motorHp: [1, 3], drive: "direct", material: "GI" }, price: 41000 },
  { modelCode: "CB-15", family: "CABINET", name: "Cabinet Exhaust Fan 1.5HP", description: "Acoustic cabinet fan for low-noise exhaust.", sizeLabel: "Size 15", specs: { airflow_m3hr: [2500, 10000], staticPressure_pa: [200, 800], motorHp: [1.5, 3], drive: "belt", material: "GI", insulated: true }, price: 88000, options: { "Acoustic lining upgrade": 15000 } },
  { modelCode: "CB-30", family: "CABINET", name: "Cabinet Supply Fan 3HP", description: "Insulated cabinet fan for fresh-air supply.", sizeLabel: "Size 30", specs: { airflow_m3hr: [5000, 18000], staticPressure_pa: [300, 1200], motorHp: [3, 7.5], drive: "belt", material: "GI", insulated: true }, price: 142000 },
  { modelCode: "ACC-VCD-400", family: "ACCESSORY", name: "Volume Control Damper 400mm", description: "Opposed-blade VCD, galvanized.", sizeLabel: "400mm", specs: { material: "GI" }, uom: "pc", price: 6500 },
  { modelCode: "ACC-FLEX-300", family: "ACCESSORY", name: "Flexible Connector 300mm", description: "Fabric flexible duct connector.", sizeLabel: "300mm", specs: { material: "Neoprene fabric" }, uom: "pc", price: 1800 },
  { modelCode: "ACC-WC-630", family: "ACCESSORY", name: "Weather Cowl 630mm", description: "Galvanized weather cowl with bird screen.", sizeLabel: "630mm", specs: { material: "GI" }, uom: "pc", price: 9500 },
  { modelCode: "ACC-AS-600", family: "ACCESSORY", name: "Gravity Shutter 600mm", description: "Aluminum gravity back-draft shutter.", sizeLabel: "600mm", specs: { material: "Aluminum" }, uom: "pc", price: 4200 },
  { modelCode: "SVC-BAL", family: "SERVICE", name: "Dynamic Balancing", description: "On-site dynamic balancing of impeller/rotor (per unit).", specs: { type: "service" }, uom: "service", price: 8500 },
  { modelCode: "SVC-LASER-PB", family: "SERVICE", name: "Laser Pulley/Belt Alignment", description: "Laser pulley & belt alignment (per drive).", specs: { type: "service" }, uom: "service", price: 6500 },
  { modelCode: "SVC-LASER-SH", family: "SERVICE", name: "Laser Shaft Alignment", description: "Laser shaft alignment for direct-coupled sets.", specs: { type: "service" }, uom: "service", price: 7500 },
  { modelCode: "SVC-MEGGER", family: "SERVICE", name: "Motor Insulation Testing", description: "Megger / motor insulation resistance test (per motor).", specs: { type: "service" }, uom: "service", price: 3500 },
  { modelCode: "OTH-CUSTOM", family: "OTHER", name: "Custom Fabrication (TBD)", description: "Custom fabricated unit — priced on engineering review.", specs: { type: "custom" }, uom: "lot", price: 0 },
];

const catId = (code: string) => `cat_${code}`;
for (const c of catalogue) {
  out.push(`INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES (${txt(catId(c.modelCode))},'${c.family}',${txt(c.modelCode)},${txt(c.name)},${txt(c.description)},${txt(c.sizeLabel ?? null)},${jsonb(c.specs)},${txt(c.uom ?? "unit")});`);
  out.push(`INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES (${txt("price_" + c.modelCode)},${txt(catId(c.modelCode))},'default',${num(c.price)},${jsonb(c.options ?? {})});`);
}

// ---- Rating points ---------------------------------------------------------
const ratingData: Record<string, Array<[number, number, number, number, number]>> = {
  "AX-630-D": [[1440,0,350,1.2,0],[1440,4000,320,1.8,0.55],[1440,8000,260,2.4,0.68],[1440,12000,170,2.9,0.62],[1440,16000,40,3.2,0.4]],
  "CF-355-BI": [[2900,0,1500,1.5,0],[2900,1500,1400,2.2,0.58],[2900,4500,1100,3.5,0.74],[2900,7000,700,4.2,0.7],[2900,9000,300,4.6,0.55]],
  "CF-560-BI": [[1750,0,2500,4.0,0],[1750,6000,2300,6.5,0.6],[1750,12000,1800,9.5,0.78],[1750,18000,1100,11.5,0.72],[1750,22000,400,12.5,0.55]],
  "TI-400": [[1400,0,500,0.5,0],[1400,2000,450,0.9,0.6],[1400,4500,350,1.4,0.71],[1400,6500,200,1.7,0.64],[1400,8000,60,1.9,0.45]],
};
let rpIdx = 0;
for (const [modelCode, points] of Object.entries(ratingData)) {
  for (const [rpm, q, sp, kw, eff] of points) {
    out.push(`INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES (${txt("rp_" + ++rpIdx)},${txt(catId(modelCode))},${num(rpm)},${num(q)},${num(sp)},${num(kw)},${num(eff)});`);
  }
}

// ---- Templates -------------------------------------------------------------
const templates = [
  { layoutKey: "standard", name: "Standard", config: { accent: "#1d4ed8", showSpecs: true, showTerms: true } },
  { layoutKey: "government", name: "Government / BAC", config: { accent: "#065f46", showSpecs: true, showTerms: true, showAbcNote: true } },
  { layoutKey: "detailed", name: "Detailed Engineering", config: { accent: "#7c3aed", showSpecs: true, showSelectionNotes: true, showTerms: true } },
  { layoutKey: "budgetary", name: "Quick Budgetary", config: { accent: "#b45309", showSpecs: false, budgetary: true } },
  { layoutKey: "export", name: "Export / USD", config: { accent: "#0f766e", currency: "USD", showSpecs: true, showTerms: true } },
];
for (const t of templates) {
  out.push(`INSERT INTO "QuotationTemplate" (id,name,"layoutKey",config) VALUES (${txt("tpl_" + t.layoutKey)},${txt(t.name)},${txt(t.layoutKey)},${jsonb(t.config)});`);
}

// ---- Sample inquiries ------------------------------------------------------
out.push(`INSERT INTO "Inquiry" (id,"customerId",source,status,"createdById",notes) VALUES
 ('seed-inquiry-1','seed-customer-a','EMAIL','DRAFTING','usr_sales',${txt("Emailed RFQ for kitchen + process exhaust.")}),
 ('seed-inquiry-2','seed-customer-b','PHOTO','NEW','usr_sales',${txt("Walk-in client handed a photo of an old fan nameplate.")});`);

out.push(`INSERT INTO "InquiryItem" (id,"inquiryId","rawText","parsedJson",qty,status) VALUES
 ('ii_1','seed-inquiry-1',${txt("Need an exhaust fan ~5000 CFM at 1 inWG for kitchen hood. Qty 2.")},${jsonb({ description: "Kitchen hood exhaust fan", airflow: 5000, airflowUnit: "CFM", staticPressure: 1, pressureUnit: "inWG", qty: 2, application: "kitchen exhaust", modelText: null })},2,'PENDING'),
 ('ii_2','seed-inquiry-1',${txt("Centrifugal blower for dust collection, around 10,000 m3/hr at 1500 Pa.")},${jsonb({ description: "Dust collection centrifugal blower", airflow: 10000, airflowUnit: "m3/hr", staticPressure: 1500, pressureUnit: "Pa", qty: 1, application: "dust collection", modelText: null })},1,'PENDING'),
 ('ii_3','seed-inquiry-2',${txt("From nameplate photo: Axial fan, 8000 m3/hr, 200 Pa, 2HP, 1440 rpm.")},${jsonb({ description: "Replacement axial fan (from nameplate)", airflow: 8000, airflowUnit: "m3/hr", staticPressure: 200, pressureUnit: "Pa", qty: 1, application: "general ventilation", modelText: "OLD-AX-2HP 1440rpm" })},1,'PENDING');`);

out.push(`INSERT INTO "Attachment" (id,"inquiryId","storagePath",kind) VALUES ('att_1','seed-inquiry-2','samples/nameplate-demo.jpg','PHOTO');`);

out.push("");
out.push("COMMIT;");

writeFileSync(join(process.cwd(), "supabase-setup.sql"), out.join("\n") + "\n");
console.log("Wrote supabase-setup.sql");
