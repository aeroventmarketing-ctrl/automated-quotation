/**
 * Seed realistic SAMPLE data so the app is fully demoable right after `npm run seed`.
 * All values are illustrative placeholders — replace with real catalogue / pricelist /
 * rating data via the Admin CSV import or by editing these rows.
 */
import { PrismaClient, Family, Role, Prisma } from "@prisma/client";
import { COMPANY } from "../src/lib/config";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding AeroQuote sample data...");

  // --- Users (one per role) ------------------------------------------------
  // NOTE: Auth identities live in Supabase Auth. Create matching Supabase users
  // with these emails (see README). The app joins by email.
  const [sales, engineer, admin] = await Promise.all([
    prisma.user.upsert({
      where: { email: "sales@aerovent.example" },
      update: {},
      create: { email: "sales@aerovent.example", name: "Sofia Sales", role: Role.SALES, salesCode: "S" },
    }),
    prisma.user.upsert({
      where: { email: "engineer@aerovent.example" },
      update: {},
      create: { email: "engineer@aerovent.example", name: "Eduardo Engineer", role: Role.ENGINEER, salesCode: "E" },
    }),
    prisma.user.upsert({
      where: { email: "admin@aerovent.example" },
      update: {},
      create: { email: "admin@aerovent.example", name: "Andrea Admin", role: Role.ADMIN, salesCode: "A" },
    }),
  ]);

  // --- Customers -----------------------------------------------------------
  const customerA = await prisma.customer.upsert({
    where: { id: "seed-customer-a" },
    update: {},
    create: {
      id: "seed-customer-a",
      company: "Metro Foods Manufacturing Inc.",
      contactName: "Ramon Dela Cruz",
      email: "ramon@metrofoods.example",
      phone: "+63 917 000 1111",
      address: "Laguna Technopark, Biñan, Laguna",
      notes: "Kitchen exhaust + process ventilation. Prefers PHP quotes.",
    },
  });
  const customerB = await prisma.customer.upsert({
    where: { id: "seed-customer-b" },
    update: {},
    create: {
      id: "seed-customer-b",
      company: "Department of Public Works (Regional Office)",
      contactName: "Engr. Liza Santos",
      email: "procurement@dpwh.example",
      phone: "+63 2 8000 2222",
      address: "Quezon City, Metro Manila",
      notes: "Government / BAC procurement — requires detailed line items.",
    },
  });

  // --- Catalogue items (~20 across families) -------------------------------
  type CatSeed = {
    modelCode: string;
    family: Family;
    name: string;
    description: string;
    sizeLabel?: string;
    specs: Record<string, unknown>;
    uom?: string;
    price: number;
    options?: Record<string, number>;
  };

  const catalogue: CatSeed[] = [
    // Axial
    { modelCode: "AX-400-D", family: Family.AXIAL, name: "Axial Flow Fan 400mm Direct", description: "Direct-drive wall axial fan for general ventilation.", sizeLabel: "400mm", specs: { airflow_m3hr: [1000, 6000], staticPressure_pa: [0, 250], motorHp: [0.5, 1], drive: "direct", material: "MS" }, price: 18500, options: { "Aluminum impeller": 3500, "Epoxy coating": 2200 } },
    { modelCode: "AX-630-D", family: Family.AXIAL, name: "Axial Flow Fan 630mm Direct", description: "High-volume axial fan for warehouses.", sizeLabel: "630mm", specs: { airflow_m3hr: [4000, 16000], staticPressure_pa: [0, 350], motorHp: [1, 3], drive: "direct", material: "MS" }, price: 34500, options: { "Aluminum impeller": 6500, "Bird screen": 1800 } },
    { modelCode: "AX-800-B", family: Family.AXIAL, name: "Axial Flow Fan 800mm Belt", description: "Belt-driven axial fan for high static applications.", sizeLabel: "800mm", specs: { airflow_m3hr: [8000, 30000], staticPressure_pa: [0, 500], motorHp: [3, 7.5], drive: "belt", material: "MS" }, price: 68000, options: { "VFD ready": 4500 } },
    // Centrifugal
    { modelCode: "CF-355-BI", family: Family.CENTRIFUGAL, name: "Centrifugal Blower 355 Backward", description: "Backward-inclined centrifugal for medium pressure.", sizeLabel: "355mm", specs: { airflow_m3hr: [1500, 9000], staticPressure_pa: [200, 1500], motorHp: [1, 5], drive: "belt", material: "MS", wheel: "backward-inclined" }, price: 56000, options: { "SS304 wheel": 18000, "Inlet damper": 7500 } },
    { modelCode: "CF-450-FC", family: Family.CENTRIFUGAL, name: "Centrifugal Blower 450 Forward", description: "Forward-curved centrifugal for HVAC supply.", sizeLabel: "450mm", specs: { airflow_m3hr: [3000, 14000], staticPressure_pa: [150, 900], motorHp: [2, 7.5], drive: "belt", material: "MS", wheel: "forward-curved" }, price: 72000, options: { "Spark-resistant": 22000 } },
    { modelCode: "CF-560-BI", family: Family.CENTRIFUGAL, name: "Centrifugal Blower 560 Backward", description: "High-efficiency backward-inclined for dust collection.", sizeLabel: "560mm", specs: { airflow_m3hr: [6000, 22000], staticPressure_pa: [500, 2500], motorHp: [5, 15], drive: "belt", material: "MS", wheel: "backward-inclined" }, price: 118000, options: { "Abrasion liner": 28000, "Drain": 1500 } },
    { modelCode: "CF-710-RT", family: Family.CENTRIFUGAL, name: "Centrifugal Blower 710 Radial", description: "Radial-tip blower for high-pressure material handling.", sizeLabel: "710mm", specs: { airflow_m3hr: [8000, 28000], staticPressure_pa: [1000, 4000], motorHp: [10, 30], drive: "belt", material: "MS", wheel: "radial" }, price: 196000 },
    // Propeller
    { modelCode: "PR-600-W", family: Family.PROPELLER, name: "Wall Propeller Fan 600mm", description: "Economical wall-mount propeller exhaust fan.", sizeLabel: "600mm", specs: { airflow_m3hr: [3000, 9000], staticPressure_pa: [0, 80], motorHp: [0.5, 1], drive: "direct", material: "MS" }, price: 12500, options: { "Auto shutter": 2800 } },
    { modelCode: "PR-900-W", family: Family.PROPELLER, name: "Wall Propeller Fan 900mm", description: "Large wall propeller for factory exhaust.", sizeLabel: "900mm", specs: { airflow_m3hr: [9000, 24000], staticPressure_pa: [0, 100], motorHp: [1, 2], drive: "direct", material: "MS" }, price: 22000, options: { "Auto shutter": 4200 } },
    // Tubular inline
    { modelCode: "TI-315", family: Family.TUBULAR_INLINE, name: "Tubular Inline Fan 315mm", description: "Inline duct fan for balanced ventilation.", sizeLabel: "315mm", specs: { airflow_m3hr: [800, 4000], staticPressure_pa: [50, 400], motorHp: [0.5, 1.5], drive: "direct", material: "GI" }, price: 28000 },
    { modelCode: "TI-400", family: Family.TUBULAR_INLINE, name: "Tubular Inline Fan 400mm", description: "Medium inline duct fan.", sizeLabel: "400mm", specs: { airflow_m3hr: [2000, 8000], staticPressure_pa: [80, 500], motorHp: [1, 3], drive: "direct", material: "GI" }, price: 41000 },
    // Cabinet
    { modelCode: "CB-15", family: Family.CABINET, name: "Cabinet Exhaust Fan 1.5HP", description: "Acoustic cabinet fan for low-noise exhaust.", sizeLabel: "Size 15", specs: { airflow_m3hr: [2500, 10000], staticPressure_pa: [200, 800], motorHp: [1.5, 3], drive: "belt", material: "GI", insulated: true }, price: 88000, options: { "Acoustic lining upgrade": 15000 } },
    { modelCode: "CB-30", family: Family.CABINET, name: "Cabinet Supply Fan 3HP", description: "Insulated cabinet fan for fresh-air supply.", sizeLabel: "Size 30", specs: { airflow_m3hr: [5000, 18000], staticPressure_pa: [300, 1200], motorHp: [3, 7.5], drive: "belt", material: "GI", insulated: true }, price: 142000 },
    // Accessories
    { modelCode: "ACC-VCD-400", family: Family.ACCESSORY, name: "Volume Control Damper 400mm", description: "Opposed-blade VCD, galvanized.", sizeLabel: "400mm", specs: { material: "GI" }, uom: "pc", price: 6500 },
    { modelCode: "ACC-FLEX-300", family: Family.ACCESSORY, name: "Flexible Connector 300mm", description: "Fabric flexible duct connector.", sizeLabel: "300mm", specs: { material: "Neoprene fabric" }, uom: "pc", price: 1800 },
    { modelCode: "ACC-WC-630", family: Family.ACCESSORY, name: "Weather Cowl 630mm", description: "Galvanized weather cowl with bird screen.", sizeLabel: "630mm", specs: { material: "GI" }, uom: "pc", price: 9500 },
    { modelCode: "ACC-AS-600", family: Family.ACCESSORY, name: "Gravity Shutter 600mm", description: "Aluminum gravity back-draft shutter.", sizeLabel: "600mm", specs: { material: "Aluminum" }, uom: "pc", price: 4200 },
    // Services
    { modelCode: "SVC-BAL", family: Family.SERVICE, name: "Dynamic Balancing", description: "On-site dynamic balancing of impeller/rotor (per unit).", specs: { type: "service" }, uom: "service", price: 8500 },
    { modelCode: "SVC-LASER-PB", family: Family.SERVICE, name: "Laser Pulley/Belt Alignment", description: "Laser pulley & belt alignment (per drive).", specs: { type: "service" }, uom: "service", price: 6500 },
    { modelCode: "SVC-LASER-SH", family: Family.SERVICE, name: "Laser Shaft Alignment", description: "Laser shaft alignment for direct-coupled sets.", specs: { type: "service" }, uom: "service", price: 7500 },
    { modelCode: "SVC-MEGGER", family: Family.SERVICE, name: "Motor Insulation Testing", description: "Megger / motor insulation resistance test (per motor).", specs: { type: "service" }, uom: "service", price: 3500 },
    // Other
    { modelCode: "OTH-CUSTOM", family: Family.OTHER, name: "Custom Fabrication (TBD)", description: "Custom fabricated unit — priced on engineering review.", specs: { type: "custom" }, uom: "lot", price: 0 },
  ];

  const catItems: Record<string, string> = {};
  for (const c of catalogue) {
    const item = await prisma.catalogueItem.upsert({
      where: { modelCode: c.modelCode },
      update: {
        family: c.family,
        name: c.name,
        description: c.description,
        sizeLabel: c.sizeLabel,
        specs: c.specs as Prisma.InputJsonValue,
        uom: c.uom ?? "unit",
        active: true,
      },
      create: {
        modelCode: c.modelCode,
        family: c.family,
        name: c.name,
        description: c.description,
        sizeLabel: c.sizeLabel,
        specs: c.specs as Prisma.InputJsonValue,
        uom: c.uom ?? "unit",
      },
    });
    catItems[c.modelCode] = item.id;

    // Matching pricelist entry.
    const existing = await prisma.priceListEntry.findFirst({
      where: { catalogueItemId: item.id, variantKey: "default" },
    });
    if (existing) {
      await prisma.priceListEntry.update({
        where: { id: existing.id },
        data: { basePrice: c.price, optionsJson: c.options ?? {} },
      });
    } else {
      await prisma.priceListEntry.create({
        data: {
          catalogueItemId: item.id,
          variantKey: "default",
          currency: "PHP",
          basePrice: c.price,
          optionsJson: c.options ?? {},
        },
      });
    }
  }

  // --- Fan rating points for 4 models (selection engine demo) --------------
  // Curves are illustrative. Each is a decreasing P-Q characteristic at a
  // reference RPM with absorbed power along the curve.
  const ratingData: Record<string, Array<[number, number, number, number, number]>> = {
    // modelCode -> [rpm, airflow_m3hr, staticPressure_pa, power_kw, efficiency]
    "AX-630-D": [
      [1440, 0, 350, 1.2, 0],
      [1440, 4000, 320, 1.8, 0.55],
      [1440, 8000, 260, 2.4, 0.68],
      [1440, 12000, 170, 2.9, 0.62],
      [1440, 16000, 40, 3.2, 0.4],
    ],
    "CF-355-BI": [
      [2900, 0, 1500, 1.5, 0],
      [2900, 1500, 1400, 2.2, 0.58],
      [2900, 4500, 1100, 3.5, 0.74],
      [2900, 7000, 700, 4.2, 0.7],
      [2900, 9000, 300, 4.6, 0.55],
    ],
    "CF-560-BI": [
      [1750, 0, 2500, 4.0, 0],
      [1750, 6000, 2300, 6.5, 0.6],
      [1750, 12000, 1800, 9.5, 0.78],
      [1750, 18000, 1100, 11.5, 0.72],
      [1750, 22000, 400, 12.5, 0.55],
    ],
    "TI-400": [
      [1400, 0, 500, 0.5, 0],
      [1400, 2000, 450, 0.9, 0.6],
      [1400, 4500, 350, 1.4, 0.71],
      [1400, 6500, 200, 1.7, 0.64],
      [1400, 8000, 60, 1.9, 0.45],
    ],
  };

  for (const [modelCode, points] of Object.entries(ratingData)) {
    const itemId = catItems[modelCode];
    if (!itemId) continue;
    await prisma.fanRatingPoint.deleteMany({ where: { catalogueItemId: itemId } });
    await prisma.fanRatingPoint.createMany({
      data: points.map(([rpm, airflow_m3hr, staticPressure_pa, power_kw, efficiency]) => ({
        catalogueItemId: itemId,
        rpm,
        airflow_m3hr,
        staticPressure_pa,
        power_kw,
        efficiency,
      })),
    });
  }

  // --- Quotation templates (5 distinct) ------------------------------------
  const templates = [
    { layoutKey: "standard", name: "Standard", config: { accent: "#1d4ed8", showSpecs: true, showTerms: true } },
    { layoutKey: "government", name: "Government / BAC", config: { accent: "#065f46", showSpecs: true, showTerms: true, showAbcNote: true } },
    { layoutKey: "detailed", name: "Detailed Engineering", config: { accent: "#7c3aed", showSpecs: true, showSelectionNotes: true, showTerms: true } },
    { layoutKey: "budgetary", name: "Quick Budgetary", config: { accent: "#b45309", showSpecs: false, budgetary: true } },
    { layoutKey: "export", name: "Export / USD", config: { accent: "#0f766e", currency: "USD", showSpecs: true, showTerms: true } },
    { layoutKey: "kdk", name: "KDK", config: { accent: "#1d4ed8", showSpecs: true, showTerms: true, terms: COMPANY.kdkTerms, specNote: "All units are made of high quality materials." } },
  ];
  for (const t of templates) {
    await prisma.quotationTemplate.upsert({
      where: { layoutKey: t.layoutKey },
      update: { name: t.name, config: t.config, active: true },
      create: {
        layoutKey: t.layoutKey,
        name: t.name,
        config: t.config,
        headerHtml: null,
        footerHtml: null,
      },
    });
  }

  // --- Sample inquiries (2; one with a photo attachment) -------------------
  const inquiry1 = await prisma.inquiry.upsert({
    where: { id: "seed-inquiry-1" },
    update: {},
    create: {
      id: "seed-inquiry-1",
      customerId: customerA.id,
      source: "EMAIL",
      status: "DRAFTING",
      createdById: sales.id,
      notes: "Emailed RFQ for kitchen + process exhaust.",
      items: {
        create: [
          {
            rawText: "Need an exhaust fan ~5000 CFM at 1 inWG for kitchen hood. Qty 2.",
            parsedJson: {
              description: "Kitchen hood exhaust fan",
              airflow: 5000,
              airflowUnit: "CFM",
              staticPressure: 1,
              pressureUnit: "inWG",
              qty: 2,
              application: "kitchen exhaust",
              modelText: null,
            },
            qty: 2,
            status: "PENDING",
          },
          {
            rawText: "Centrifugal blower for dust collection, around 10,000 m3/hr at 1500 Pa.",
            parsedJson: {
              description: "Dust collection centrifugal blower",
              airflow: 10000,
              airflowUnit: "m3/hr",
              staticPressure: 1500,
              pressureUnit: "Pa",
              qty: 1,
              application: "dust collection",
              modelText: null,
            },
            qty: 1,
            status: "PENDING",
          },
        ],
      },
    },
  });

  const inquiry2 = await prisma.inquiry.upsert({
    where: { id: "seed-inquiry-2" },
    update: {},
    create: {
      id: "seed-inquiry-2",
      customerId: customerB.id,
      source: "PHOTO",
      status: "NEW",
      createdById: sales.id,
      notes: "Walk-in client handed a photo of an old fan nameplate.",
      items: {
        create: [
          {
            rawText: "From nameplate photo: Axial fan, 8000 m3/hr, 200 Pa, 2HP, 1440 rpm.",
            parsedJson: {
              description: "Replacement axial fan (from nameplate)",
              airflow: 8000,
              airflowUnit: "m3/hr",
              staticPressure: 200,
              pressureUnit: "Pa",
              qty: 1,
              application: "general ventilation",
              modelText: "OLD-AX-2HP 1440rpm",
            },
            qty: 1,
            status: "PENDING",
          },
        ],
      },
      attachments: {
        create: [
          {
            // Placeholder path — real uploads go to Supabase Storage.
            storagePath: "samples/nameplate-demo.jpg",
            kind: "PHOTO",
          },
        ],
      },
    },
  });

  console.log("✅ Seed complete:");
  console.log(`   Users: ${[sales, engineer, admin].map((u) => u.email).join(", ")}`);
  console.log(`   Customers: 2, Catalogue: ${catalogue.length}, Templates: ${templates.length}`);
  console.log(`   Rating models: ${Object.keys(ratingData).length}, Inquiries: 2 (${inquiry1.id}, ${inquiry2.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
