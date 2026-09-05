#!/usr/bin/env node
/**
 * ROLE HARNESS — run the real app locally and look at it as each role.
 *
 * The capability grid (`src/lib/catalogue-access.test.ts`) proves the *rules*.
 * This proves the *screens*: a button wired to the wrong flag, a panel that
 * never opens, a page that refuses someone the nav just invited. Every
 * permission bug that reached the owner in August was of that second kind, and
 * none of them could be caught by typecheck, lint or the build.
 *
 *   node scripts/role-harness.mjs            # boot, probe every role, print a table
 *   node scripts/role-harness.mjs --keep     # …and leave the server up to click around
 *
 * WHAT IT DOES NOT DO: touch this repository. It builds a throwaway git worktree
 * under /var/tmp, patches `getCurrentUser` THERE to read an `e2e_as` cookie, and
 * deletes the worktree on exit. Production code never contains an auth bypass —
 * that is the whole reason for the worktree rather than an env-gated backdoor.
 *
 * Requires: a local Postgres (see PG_URL below) and node_modules already
 * installed in this repo (the worktree symlinks them).
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, openSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const WORKTREE = "/var/tmp/aq-role-harness";
const PORT = Number(process.env.HARNESS_PORT ?? 3111);
const PG_URL = process.env.HARNESS_DATABASE_URL ?? "postgresql://postgres@localhost:5433/postgres";
const KEEP = process.argv.includes("--keep");
const LOG = "/var/tmp/role-harness.log";
const REPO = process.cwd();

/** The people to look as. `roles` are workflow-role keys; base is the User.role. */
const CAST = [
  { email: "harness-admin@test", name: "Admin Ana", base: "ADMIN", roles: [] },
  { email: "harness-wh@test", name: "Willy Ho", base: "OTHER", roles: ["warehouse"] },
  { email: "harness-pu@test", name: "Allan Ramos", base: "OTHER", roles: ["purchaser"] },
  { email: "harness-pa@test", name: "Rey Gil", base: "OTHER", roles: ["payment_approver"] },
  // Accounting attaches the check, prepares the voucher and reconciles it — real
  // powers that nobody in the cast held, so every check screen was a blind spot.
  // The owner reported "accounting role cannot upload check" against a cast that
  // could not have caught it.
  { email: "harness-acct@test", name: "Michelle Cotura", base: "OTHER", roles: ["accounting"] },
  { email: "harness-sales@test", name: "Sam Sales", base: "SALES", roles: [] },
  // An ENGINEER holds no workflow role, so every rule that keys off one misses
  // them — which is exactly how the nav came to offer them Products while the
  // page refused it. A base role the harness cannot look as is a blind spot.
  { email: "harness-eng@test", name: "Elena Cruz", base: "ENGINEER", roles: [] },
];

/**
 * What to look for in the rendered HTML. Each probe is a thing a person can see
 * or press — deliberately UI-level, because the grid already covers the rules.
 */
const PROBES = [
  { path: "/inventory", label: "inv", checks: {
    open: (t) => !t.includes("don't have access to inventory"),
    cost: (t) => t.includes("Unit cost"),
    value: (t) => /STOCK VALUE/i.test(t),
    import: (t) => t.includes("Import from file"),
    download: (t) => t.includes("Download Excel"),
    // The Warehouse/admin toolbar uses an icon button; the Purchaser and price
    // owner get a labelled one. Look for either.
    edit: (t) => / Edit\b/.test(t) || /aria-label="Edit"/.test(t),
    approve: (t) => /AWAITING[\s\S]{0,300}?\bApprove\b/.test(t),
  } },
  { path: "/inventory/approvals", label: "history", checks: {
    open: (t) => !t.includes("can read the catalogue approval record"),
    record: (t) => t.includes("CUTTING DISC"),
    signatures: (t) => t.includes("Rey Gil") && t.includes("Allan Ramos"),
  } },
  // Requisitions has the same nav-offers/page-refuses shape as the catalogue
  // screens: the tab is open to every base role, and the page decides. The
  // Payment Approver hit the refusal after being invited by the nav.
  //
  // `open` is the page letting you in; `form` is the page offering the New
  // department requisition card. Neither proves the SUBMIT will be accepted —
  // `createDepartmentRequisition` re-checks the role server-side, and an Office
  // requisition raised by someone it doesn't recognise throws. A probe can't see
  // that without posting, so a `form=true` role is worth submitting as by hand.
  { path: "/requisitions", label: "reqs", checks: {
    open: (t) => !t.includes("have access to raise department requisitions"),
    form: (t) => t.includes("New department requisition"),
  } },
  // The check controls on a PO row. Attaching stops at COMPLETED for Accounting
  // but not for an admin or the Payment Approver, and "the button is missing"
  // is indistinguishable from "the rule says no" unless both POs are on screen.
  /**
   * The check controls on a COMPLETED PO — who may attach, and who only sees the
   * badge. Every widening of this rule has been about that one status, and the
   * owner reported each of them from a completed PO.
   *
   * Anchored to the PO number, not page-wide: "is there an Attach button
   * anywhere" cannot tell *blocked on the completed one* from *blocked
   * everywhere*, and those are different bugs.
   *
   * The seed also creates a live (Budgeted) PO — `HARNESS-LIVE` — but its row
   * lives behind the workspace's Budgeted TAB, which is client-rendered, so a
   * scraper never sees it. Probing it would print a column of falses that look
   * like a permission bug and are not. Click it by hand with `--keep`.
   */
  { path: "/purchasing", label: "check", checks: {
    open: (t) => !t.includes("don't have access"),
    doneRow: (t) => t.includes("HARNESS-DONE"),
    doneAttach: (t) => near(t, "HARNESS-DONE", /Attach check|Add check/),
    doneBadge: (t) => near(t, "HARNESS-DONE", /Check not attached/),
    // Whether the AMBER "no photo ever attached" reminder is all they get.
    doneViewOnly: (t) => near(t, "HARNESS-DONE", /Check not attached/) && !near(t, "HARNESS-DONE", /Attach check|Add check/),
  } },
  /**
   * The due date of purchase — *"purchaser or admin/payment approver can add due
   * date of purchase."* `set` is the control being offered; everyone else who can
   * see the page should read the date and be unable to touch it.
   */
  { path: "/purchasing", label: "due", checks: {
    open: (t) => !t.includes("don't have access"),
    reads: (t) => /No purchase due date|Buy by|Overdue —|Bought · was due/.test(t),
    set: (t) => /No purchase due date\s*Add one|(Buy by|Overdue —)[^|]{0,40}Change/.test(t),
  } },
  /**
   * The Production Status card — *"Once item is delivered remove it from the
   * list."* The seed carries two orders with identical job orders (nothing ever
   * stamped finished, Duct already overdue); only their stage differs.
   *
   * `live` is the in-production one, which must be listed; `delivered` is the
   * delivered one, which must not be. Probing only for the absence would pass on
   * a card that renders nothing at all.
   */
  { path: "/my-dashboard", label: "prodstatus", checks: {
    card: (t) => t.includes("Production Status"),
    live: (t) => prodStatusRow(t, "HARNESS0001"),
    delivered: (t) => prodStatusRow(t, "HARNESSDELIVERED"),
  } },
  { path: "/products", label: "prod", checks: {
    open: (t) => !t.includes("don't have access to the product list"),
    price: (t) => t.includes("₱"),
    import: (t) => t.includes("Import from file"),
    add: (t) => t.includes("+ Add product"),
  } },
];

/**
 * Does this order have a row on the Production Status CARD?
 *
 * Not "does the quote number appear on the dashboard": a delivered order
 * legitimately appears elsewhere on the same page — Sales and Accounting get it
 * under *Pending Your Action* ("Approve POD"). Both a page-wide search and a
 * generous window after the card's subtitle reported the delivered order
 * "present" for three roles who were reading it in that other card entirely.
 *
 * A card row ends `<quote number> due <Mon D>`, which nothing else on the page
 * does — so the row's own shape is the anchor.
 */
const prodStatusRow = (t, quoteNo) => new RegExp(`${quoteNo}\\s+due\\s+[A-Z][a-z]{2}\\s+\\d`).test(t);

/** Does `re` appear in the text just AFTER `marker` — i.e. on that PO's own row? */
const near = (t, marker, re, span = 1200) => {
  const i = t.indexOf(marker);
  return i >= 0 && re.test(t.slice(i, i + span));
};

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ").replace(/\s+/g, " ");

/**
 * A copy of the WORKING TREE, not of HEAD.
 *
 * The first version used `git worktree add HEAD` and duly reproduced a bug that
 * had already been fixed on disk but not yet committed — it was testing the last
 * commit. The whole point is to check a change before you commit it, so the copy
 * has to include uncommitted edits.
 */
function makeWorktree() {
  if (existsSync(WORKTREE)) rmSync(WORKTREE, { recursive: true, force: true });
  mkdirSync(WORKTREE, { recursive: true });
  sh(`tar -c --exclude=node_modules --exclude=.next --exclude=.git -C ${REPO} . | tar -x -C ${WORKTREE}`, { shell: "/bin/bash" });
  symlinkSync(`${REPO}/node_modules`, `${WORKTREE}/node_modules`);

  // The one patch, applied only to the throwaway copy.
  const authPath = `${WORKTREE}/src/lib/auth.ts`;
  const src = readFileSync(authPath, "utf8");
  const anchor = "export async function getCurrentUser(): Promise<User | null> {";
  if (!src.includes(anchor)) throw new Error("auth.ts has moved — update the harness patch anchor.");
  writeFileSync(authPath, src.replace(anchor, `${anchor}
  // HARNESS ONLY — throwaway worktree, never committed.
  if (process.env.HARNESS_AUTH === "1") {
    const { cookies } = await import("next/headers");
    const email = (await cookies()).get("e2e_as")?.value;
    if (!email) return null;
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }`));
}

async function seed() {
  const { PrismaClient } = await import(`${REPO}/node_modules/@prisma/client/index.js`);
  const p = new PrismaClient({ datasources: { db: { url: PG_URL } } });
  const ids = {};
  for (const c of CAST) {
    const u = await p.user.upsert({
      where: { email: c.email }, update: { name: c.name, role: c.base },
      create: { email: c.email, name: c.name, role: c.base },
    });
    ids[c.email] = u.id;
  }
  const assignments = {};
  for (const c of CAST) if (c.roles.length) assignments[ids[c.email]] = c.roles;
  const value = { assignments };
  await p.appSetting.upsert({ where: { key: "workflow_roles" }, update: { value }, create: { key: "workflow_roles", value } });

  await p.stockAction.deleteMany({});
  await p.stockMovement.deleteMany({});
  await p.stockReservation.deleteMany({});
  await p.stockItem.deleteMany({});
  for (const [n, q, c, s] of [["BELT B-50", 4, 210, 300], ["GI SHEET 24GA", 50, 850, 1100], ["CUTTING DISC 4in", 12, 29, 45]]) {
    await p.stockItem.create({ data: { name: n, unit: "pc", quantity: q, reorderLevel: 2, unitCost: c, sellPrice: s, location: "Plant Warehouse" } });
  }
  // A Warehouse request the Purchaser has already approved — the state the owner
  // reported as stuck. It must show as AWAITING the price owner, not applied.
  const belt = await p.stockItem.findFirst({ where: { name: "BELT B-50" } });
  await p.stockAction.create({ data: {
    stockItemId: belt.id, itemName: belt.name, kind: "ADJUST",
    payload: { kind: "RECEIPT", qty: 6, reason: "delivery" },
    summary: "Receive +6 pc · BELT B-50 (now 4 pc) · delivery",
    proposedById: ids["harness-wh@test"], proposedByName: "Willy Ho", proposedRole: "warehouse",
    warehouseByName: "Willy Ho", warehouseAt: new Date(),
    purchaserByName: "Allan Ramos", purchaserAt: new Date(),
  } });
  // …and one already decided, so the approval HISTORY has something to show.
  // A record you can only see when it is empty proves nothing.
  const disc = await p.stockItem.findFirst({ where: { name: "CUTTING DISC 4in" } });
  await p.stockAction.create({ data: {
    stockItemId: disc.id, itemName: disc.name, kind: "EDIT",
    payload: { category: "SUPPLIES", location: "Plant Warehouse", reorderLevel: 2, unitCost: 29, sellPrice: 45 },
    summary: "Edit CUTTING DISC 4in: unit cost ₱29.00, sell ₱45.00", status: "APPLIED",
    // Backdated in order — a record whose signatures predate the request it
    // signs reads as nonsense to anyone checking the harness output.
    proposedById: ids["harness-wh@test"], proposedByName: "Willy Ho", proposedRole: "warehouse",
    proposedAt: new Date(Date.now() - 7200e3),
    warehouseByName: "Willy Ho", warehouseAt: new Date(Date.now() - 7200e3),
    purchaserByName: "Allan Ramos", purchaserAt: new Date(Date.now() - 3600e3),
    approverByName: "Rey Gil", approverAt: new Date(Date.now() - 1800e3),
    appliedAt: new Date(Date.now() - 1800e3),
  } });
  // --- Checks: a supplier who gives us terms, and two POs to them ------------
  //
  // One LIVE (Budgeted) and one COMPLETED, because the whole question is which
  // of the two still offers the upload control, and to whom.
  const suppliers = { list: [{ id: "s-harness", company: "HARNESS STEEL CORP", terms: true }] };
  await p.appSetting.upsert({ where: { key: "suppliers" }, update: { value: suppliers }, create: { key: "suppliers", value: suppliers } });

  await p.purchaseRequest.deleteMany({ where: { note: { startsWith: "HARNESS-" } } });
  const poFor = (n) => ({
    poNumber: n, date: "2026-09-01",
    supplier: { company: "HARNESS STEEL CORP" },
    lines: [{ description: "GI SHEET 24GA", qty: 10, unitPrice: 850 }],
    ewtPct: 1,
  });
  // A handful of read checks with real clearing dates, so the Check Monitoring
  // register has something to search, sort and group.
  const checkDoc = (no, ymd, amount) => ({
    path: `purchases/x/${no}.jpg`, name: `${no}.jpg`, uploadedAt: "", uploadedByName: "Michelle Cotura",
    read: {
      accountNo: "003718007033", accountName: "AEROVENT FANS AND BLOWERS MANUFACTURING",
      checkNo: no, payee: "HARNESS STEEL CORP", clearingYMD: ymd,
      // The eight DATE-box digits the date was assembled from — a CONFIRMED
      // date, as every read taken since 2026-09-04 produces.
      dateBoxes: `${ymd.slice(5, 7)}${ymd.slice(8, 10)}${ymd.slice(0, 4)}`,
      amount, amountFigures: amount, amountFromWords: amount, amountWords: "", bank: "BDO",
      confidence: 0.95, warnings: [], issues: [], readByName: "Michelle Cotura", readAt: "",
    },
  });
  // One check in the owner's reported state: a clearing date the model wrote
  // itself, with no DATE-box digits behind it — the shape that put 17 October
  // in the register as 17 July, reading "49 days ago".
  await p.purchaseRequest.create({ data: {
    kind: "department", dept: "office", items: ["GI SHEET 24GA x 10"],
    note: "HARNESS-CHK-UNCONFIRMED", status: "CASH_RELEASED",
    po: { ...poFor("HARNESS-CHK-UNSURE"), supplier: { company: "POWERLINK MERCHANDISE" } },
    chainLog: { approve_po: { byName: "Rey Gil", at: new Date().toISOString() } },
    voucherCheckDocs: [{ ...checkDoc("0000486709", "2026-07-17", 39210.75), read: { ...checkDoc("0000486709", "2026-07-17", 39210.75).read, dateBoxes: null } }],
    createdById: ids["harness-acct@test"], createdByName: "Michelle Cotura",
  } });

  for (const [no, ymd, amt, company] of [
    ["0000486901", "2026-09-10", 28344.64, "HARNESS STEEL CORP"],
    ["0000486902", "2026-10-02", 2836.94, "WIDGET SUPPLY INC"],
    ["0000486903", "2026-10-04", 2160.54, "WIDGET SUPPLY INC"],
  ]) {
    await p.purchaseRequest.create({ data: {
      kind: "department", dept: "office", items: ["GI SHEET 24GA x 10"],
      note: `HARNESS-CHK-${no}`, status: "CASH_RELEASED",
      po: { ...poFor(`HARNESS-CHK-${no}`), supplier: { company } },
      chainLog: { approve_po: { byName: "Rey Gil", at: new Date().toISOString() } },
      voucherCheckDocs: [checkDoc(no, ymd, amt)],
      createdById: ids["harness-acct@test"], createdByName: "Michelle Cotura",
    } });
  }

  // A purchase carrying a DUE DATE, already past — so the probe can tell
  // "can read it" apart from "there is nothing to read".
  await p.purchaseRequest.create({ data: {
    kind: "department", dept: "office", items: ["GI SHEET 24GA x 10"],
    note: "HARNESS-DUE", status: "CASH_RELEASED",
    po: { ...poFor("HARNESS-DUE"), supplier: { company: "HARNESS STEEL CORP" } },
    chainLog: { approve_po: { byName: "Rey Gil", at: new Date().toISOString() } },
    purchaseDueAt: new Date("2026-08-20T00:00:00.000Z"),
    createdById: ids["harness-acct@test"], createdByName: "Michelle Cotura",
  } });

  for (const [status, poNo] of [["CASH_RELEASED", "HARNESS-LIVE"], ["COMPLETED", "HARNESS-DONE"]]) {
    await p.purchaseRequest.create({ data: {
      // A DEPARTMENT requisition, not a replenishment: replenishment rows render
      // in their own list, which carries no check control — seeding one produced
      // an all-false table that looked like a permission bug and was not.
      kind: "department", dept: "office", items: ["GI SHEET 24GA x 10"],
      note: `HARNESS-${status}`, status,
      po: poFor(poNo),
      // `approve_po`, not `po_approved`: without it a DEPARTMENT requisition sits
      // in the "pending" bucket whatever its status, and every check control
      // disappears — which reads exactly like a permission bug.
      chainLog: { approve_po: { byName: "Rey Gil", at: new Date().toISOString() } },
      createdById: ids["harness-acct@test"], createdByName: "Michelle Cotura",
    } });
  }

  // --- An ORDER with job-order deadlines -------------------------------------
  //
  // The Purchasing page shows every department's deadline beside the order
  // number, and the deadlines live on the order's workflow — so verifying that
  // header needs a real quotation behind a real order-linked purchase.
  const customer = await p.customer.upsert({
    where: { id: "harness-customer" },
    update: {}, create: { id: "harness-customer", company: "HARNESS CLIENT CORP" },
  });
  const template = await p.quotationTemplate.upsert({
    where: { layoutKey: "harness" },
    update: {}, create: { name: "Harness", layoutKey: "harness" },
  });
  const inquiry = await p.inquiry.upsert({
    where: { id: "harness-inquiry" },
    update: {},
    create: { id: "harness-inquiry", customerId: customer.id, createdById: ids["harness-sales@test"], projectName: "Harness Project" },
  });
  // Four departments, four deadlines — the case the owner chose to show whole.
  // A confirmed sale (a PO on terms) because the Production Status card sources
  // from confirmed sales, not from the inquiry's status.
  const orderClassification = (stage) => ({
    sale: { arrangement: "terms", po: { path: "harness/po.pdf", name: "po.pdf", uploadedAt: new Date().toISOString() } },
    workflow: {
      stage,
      jobOrders: {
        fans: { status: "issued", dueAt: "2026-10-20" },
        duct: { status: "issued", dueAt: "2026-09-01" },
        accessories: { status: "issued", dueAt: "2026-10-25" },
        motor: { status: "issued" },
      },
    },
  });
  const order = async (id, quoteNumber, stage) => {
    const classification = orderClassification(stage);
    // `update` carries the classification too: a stage the seed no longer sets
    // would otherwise survive in a database from an earlier run, and the harness
    // would be probing yesterday's fixture.
    return p.quotation.upsert({
      where: { id },
      update: { classification },
      create: {
        id, inquiryId: inquiry.id, quoteNumber, templateId: template.id,
        preparedById: ids["harness-sales@test"], total: 100000, classification,
      },
    });
  };
  const quote = await order("harness-quote", "2026 - HARNESS0001", "in_production");
  // The owner: *"Once item is delivered remove it from the list."* Same job
  // orders, same overdue Duct deadline, none of them ever stamped finished — the
  // only difference is that this order has been delivered, and that alone must
  // keep it off the Production Status card.
  await order("harness-quote-delivered", "2026 - HARNESSDELIVERED", "delivered");
  await p.purchaseRequest.deleteMany({ where: { note: "HARNESS-ORDER-PR" } });
  await p.purchaseRequest.create({ data: {
    kind: "order", dept: "fans", items: ["GI SHEET 24GA x 10"], note: "HARNESS-ORDER-PR",
    status: "CASH_RELEASED", quotationId: quote.id,
    po: { ...poFor("HARNESS-ORDER"), supplier: { company: "HARNESS STEEL CORP" } },
    chainLog: { approve_po: { byName: "Rey Gil", at: new Date().toISOString() } },
    createdById: ids["harness-pu@test"], createdByName: "Allan Ramos",
  } });

  await p.$disconnect();
}

async function boot() {
  // Refuse to run against SOMEBODY ELSE's server. A stale process from a previous
  // run answered the readiness probe once and every probe then reported "false"
  // — the harness was measuring an app that did not contain the change.
  try {
    await fetch(`http://localhost:${PORT}/login`, { signal: AbortSignal.timeout(1500) });
    throw new Error(`port ${PORT} is already serving something. Stop it (pkill -f "next dev -p ${PORT}") or set HARNESS_PORT.`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("already serving")) throw e;
  }
  const env = {
    ...process.env, HARNESS_AUTH: "1", DATABASE_URL: PG_URL, DIRECT_URL: PG_URL,
    // Left unset on purpose: the middleware waves everything through without it,
    // which is what lets the cookie identity reach the pages.
    NEXT_PUBLIC_SUPABASE_URL: "",
  };
  // Always logged. A silent harness that reports "everything false" because the
  // server never compiled is worse than no harness at all.
  const log = openSync(LOG, "w");
  // `detached` so the whole tree gets its own process group: `npx` spawns the
  // real server as a child, and killing only `npx` left a zombie holding the port
  // and serving a worktree that had already been deleted — the next run then met
  // "Internal Server Error" from an app that no longer existed on disk.
  const proc = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: WORKTREE, env, stdio: ["ignore", log, log], detached: true });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (proc.exitCode !== null) throw new Error(`dev server exited (${proc.exitCode}) — see ${LOG}`);
    try { await fetch(`http://localhost:${PORT}/login`); return proc; } catch { /* not up yet */ }
  }
  throw new Error(`dev server did not start — see ${LOG}`);
}

async function probe() {
  const rows = [];
  for (const c of CAST) {
    for (const { path, label, checks } of PROBES) {
      const res = await fetch(`http://localhost:${PORT}${path}`, { headers: { Cookie: `e2e_as=${c.email}` }, redirect: "manual" });
      // Keep the raw HTML for probes that need an attribute (icon buttons).
      const raw = res.status === 200 ? await res.text() : "";
      const t = raw ? strip(raw) + " " + raw.match(/aria-label="[^"]*"/g)?.join(" ") : "";
      const cells = Object.fromEntries(Object.entries(checks).map(([k, f]) => [k, res.status === 200 ? f(t) : false]));
      rows.push({ who: c.name, page: label, ...cells });
    }
  }
  return rows;
}

let proc;
try {
  console.log("· worktree");
  makeWorktree();
  console.log("· seed");
  await seed();
  console.log(`· boot (port ${PORT}) — first compile takes ~30s`);
  proc = await boot();
  console.log("· probe\n");
  const rows = await probe();
  if (rows.every((r) => r.open === false)) {
    console.error(`\nEvery page refused — that is the server, not the policy. Tail of ${LOG}:\n`);
    console.error(readFileSync(LOG, "utf8").split("\n").slice(-25).join("\n"));
  }
  for (const page of PROBES.map((p) => p.label)) {
    console.log(`— ${page} —`);
    console.table(rows.filter((r) => r.page === page).map(({ page: _p, ...r }) => r));
  }
  if (KEEP) {
    console.log(`\nServer left up: http://localhost:${PORT}  (cookie e2e_as=<email>)`);
    console.log(CAST.map((c) => `  ${c.email}  ${c.name}`).join("\n"));
    // Ctrl-C must take the server and the copy with it, or the next run inherits
    // a zombie on the port.
    const stop = () => {
      if (proc?.pid) { try { process.kill(-proc.pid, "SIGTERM"); } catch { /* gone */ } }
      try { rmSync(`${WORKTREE}/node_modules`, { force: true }); } catch { /* symlink */ }
      try { rmSync(WORKTREE, { recursive: true, force: true }); } catch { /* gone */ }
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => {});
  }
} finally {
  if (!KEEP) {
    if (proc?.pid) { try { process.kill(-proc.pid, "SIGTERM"); } catch { /* already gone */ } }
    try { rmSync(`${WORKTREE}/node_modules`, { force: true }); } catch { /* symlink */ }
    try { rmSync(WORKTREE, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}
