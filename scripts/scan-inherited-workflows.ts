/**
 * Command-line form of the Admin → Data check scan.
 *
 * READ ONLY — it never writes. The detection itself lives in
 * src/lib/inherited-workflow-scan.ts so this and the admin page can never drift
 * apart; this file only prints.
 *
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/scan-inherited-workflows.ts
 *
 * Both variables must be set even though nothing is written — Prisma refuses to
 * start when `directUrl` has no value. `npx vercel env pull .env` sets both.
 *
 * Most of the time you want the page instead: Admin → Data check, which runs the
 * same scan with the credentials the app already holds.
 */
import { scanInheritedWorkflows } from "../src/lib/inherited-workflow-scan";
import { prisma } from "../src/lib/db";

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ");

async function main() {
  const { scanned, findings } = await scanInheritedWorkflows();
  console.log(`Scanned ${scanned} quotations.\n`);

  for (const f of findings) {
    console.log(`${f.quoteNumber}  [${f.status}]  ${f.company}`);
    console.log(`  created      ${fmt(f.createdAt)}${f.duplicatedFrom ? `   (duplicated from ${f.duplicatedFrom})` : ""}`);
    console.log(`  stage now    ${f.stage}`);
    if (f.stamps.length) {
      console.log(`  INHERITED    ${f.stamps.length} of ${f.totalStamps} recorded step(s) predate this quotation — earliest ${fmt(f.stamps[0].at)} at "${f.stamps[0].where}"`);
      console.log(`               ${f.stamps.length === f.totalStamps ? "ALL of them — this order has done none of its own work." : `the other ${f.totalStamps - f.stamps.length} are its own.`}`);
      for (const s of f.stamps.slice(0, 6)) console.log(`                 ${fmt(s.at)}  ${s.where}`);
      if (f.stamps.length > 6) console.log(`                 …and ${f.stamps.length - 6} more`);
    }
    for (const p of f.foreignPaths.slice(0, 6)) console.log(`  FOREIGN FILE ${p.field}: ${p.path}`);
    if (f.foreignPaths.length > 6) console.log(`               …and ${f.foreignPaths.length - 6} more`);
    console.log();
  }

  console.log(
    findings.length === 0
      ? "No quotations carry inherited state."
      : `${findings.length} quotation(s) carry inherited state.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
