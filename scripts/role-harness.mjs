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
  { email: "harness-sales@test", name: "Sam Sales", base: "SALES", roles: [] },
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
  { path: "/products", label: "prod", checks: {
    open: (t) => !t.includes("don't have access to the product list"),
    price: (t) => t.includes("₱"),
    import: (t) => t.includes("Import from file"),
    add: (t) => t.includes("+ Add product"),
  } },
];

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
  const proc = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: WORKTREE, env, stdio: ["ignore", log, log], detached: false });
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
    await new Promise(() => {});
  }
} finally {
  if (!KEEP) {
    if (proc) proc.kill();
    try { rmSync(`${WORKTREE}/node_modules`, { force: true }); } catch { /* symlink */ }
    try { rmSync(WORKTREE, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}
