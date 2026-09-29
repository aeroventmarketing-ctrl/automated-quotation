/**
 * The PO-supplier audit, against a real Postgres so the JSON columns, the
 * combined-PO shape and the catalogue reads are the real ones.
 *
 *   TEST_DATABASE_URL=postgresql://… npx vitest run src/lib/po-supplier-audit
 *
 * What matters here is mostly what it DOESN'T report: a diagnostic that cries
 * wolf is one nobody opens twice.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "";
const run = TEST_DB ? describe : describe.skip;

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

process.env.DATABASE_URL = TEST_DB;
process.env.DIRECT_URL = TEST_DB;

const { PrismaClient } = await import("@prisma/client");
const prisma = new (PrismaClient as unknown as new () => import("@prisma/client").PrismaClient)();
const { auditPoSuppliers } = await import("./po-supplier-audit");

const IDEAL = { id: "sup-ideal", company: "IDEAL CONTROLS INCORPORATED" };
const ZENITH = { id: "sup-zenith", company: "ZENITH UNITED ELECTRIC CORP." };
const VAV = 'NENUTEC VARIABLE AIR VOLUME 6" DIAMETER';
const SPEC = "Complete with VAV Actuator & Thermostat · Duct Diameter: 250 mm (10 in)";

const po = (company: string, price: string, batchId?: string) => ({
  poNumber: "PO-TEST-0001",
  date: "2026-09-01",
  supplier: { company, attention: "", address: "" },
  lines: [{ description: `${VAV} · ${SPEC}`, qty: "2", unit: "pc", unitPrice: price }],
  ...(batchId ? { batchId } : {}),
});

async function makeRequest(poJson: unknown, id: string) {
  await prisma.purchaseRequest.create({
    data: {
      id, kind: "order", dept: "office", status: "APPROVED",
      items: [`2 pc · ${VAV} · ${SPEC}`],
      createdById: "test-user", createdByName: "Tester",
      po: poJson as never,
    },
  });
}

run("auditPoSuppliers", () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });

  beforeEach(async () => {
    await prisma.purchaseRequest.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.appSetting.deleteMany({ where: { key: "suppliers" } });
    await prisma.appSetting.upsert({
      where: { key: "suppliers" },
      create: { key: "suppliers", value: { list: [IDEAL, ZENITH] } },
      update: { value: { list: [IDEAL, ZENITH] } },
    });
    await prisma.product.create({
      data: {
        sku: "CAT00199", name: VAV, unit: "pc", category: "AEROVENT",
        suppliers: [{ supplierId: IDEAL.id, company: IDEAL.company, price: 30894 }],
      },
    });
  });

  it("reports a PO whose supplier the catalogue does not list for what it buys", async () => {
    await makeRequest(po(ZENITH.company, "558"), "pr-wrong");
    const { issues } = await auditPoSuppliers();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      poNumber: "PO-TEST-0001",
      supplier: ZENITH.company,
      carriers: [IDEAL.company],
      matchedLines: 1,
      totalLines: 1,
      poTotal: 1116,
      catalogueTotal: 61788,
    });
  });

  it("says nothing when the PO names the supplier the catalogue names", async () => {
    await makeRequest(po(IDEAL.company, "30894"), "pr-right");
    expect((await auditPoSuppliers()).issues).toEqual([]);
  });

  /**
   * The audit must not report a RENAME. The PO stores a company name only, so a
   * supplier renamed since it was raised would otherwise look like a mismatch on
   * every order it ever appeared on.
   */
  it("follows the supplier id when the product still carries the old name", async () => {
    await prisma.product.update({
      where: { sku: "CAT00199" },
      data: { suppliers: [{ supplierId: IDEAL.id, company: "IDEAL CONTROLS", price: 30894 }] },
    });
    await makeRequest(po(IDEAL.company, "30894"), "pr-renamed");
    expect((await auditPoSuppliers()).issues).toEqual([]);
  });

  it("has no opinion on a PO for something the catalogue does not hold", async () => {
    await prisma.product.deleteMany({});
    await makeRequest(po(ZENITH.company, "558"), "pr-uncatalogued");
    const audit = await auditPoSuppliers();
    expect(audit.purchaseOrders).toBe(1);
    expect(audit.issues).toEqual([]);
  });

  /** A combined PO is one document held on every member request. */
  it("reports a combined PO once, and counts its members", async () => {
    await makeRequest(po(ZENITH.company, "558", "batch-1"), "pr-a");
    await makeRequest(po(ZENITH.company, "558", "batch-1"), "pr-b");
    await makeRequest(po(ZENITH.company, "558", "batch-1"), "pr-c");
    const { issues } = await auditPoSuppliers();
    expect(issues).toHaveLength(1);
    expect(issues[0].members).toBe(3);
  });

  it("leaves the catalogue total empty rather than half-built", async () => {
    // A second line the catalogue cannot price: a total covering one line of two,
    // printed beside the PO's full value, would invite a wrong conclusion.
    const two = po(ZENITH.company, "558");
    two.lines.push({ description: "SOMETHING UNCATALOGUED", qty: "1", unit: "pc", unitPrice: "100" });
    await makeRequest(two, "pr-partial");
    const { issues } = await auditPoSuppliers();
    expect(issues).toHaveLength(1);
    expect(issues[0].catalogueTotal).toBeNull();
    expect(issues[0]).toMatchObject({ matchedLines: 1, totalLines: 2 });
  });

  it("puts the biggest money gap first", async () => {
    await makeRequest(po(ZENITH.company, "558"), "pr-small");
    const big = po(ZENITH.company, "558");
    big.poNumber = "PO-TEST-0002";
    big.lines[0].qty = "20";
    await makeRequest(big, "pr-big");
    const { issues } = await auditPoSuppliers();
    expect(issues.map((i) => i.poNumber)).toEqual(["PO-TEST-0002", "PO-TEST-0001"]);
  });
});
