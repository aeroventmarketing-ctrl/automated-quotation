import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { checkReadSchema } from "@/lib/ai/schemas";
import { AI_CHECK_READ_LIMIT } from "@/lib/ai/limits";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { canAttachCheck, coerceCheckDocs, checkIssues, type CheckDoc, type CheckRead } from "@/lib/voucher-check";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { pesoAmountInWords } from "@/lib/amount-words";
import { COMPANY } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  purchaseRequestId: z.string(),
  path: z.string(),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Reading the photo of a company check.
 *
 * The prompt is the owner's own field map, written down: they walked a practice
 * check field by field, and each rule below is one of those points. Two of them
 * are worth more than the rest —
 *
 *  - **the DATE box is the CLEARING date, not the day the check was written.**
 *    A post-dated check (a PDC, which is how most terms suppliers are paid here)
 *    carries a date weeks ahead; reading it as an issue date would put every
 *    payment in the wrong month.
 *  - **the amount is read twice**, in figures and in words, and never
 *    reconciled by the model. A check carries its own cross-check on its face;
 *    the system compares the two itself, so a misread digit shows up as a
 *    disagreement instead of a confident wrong answer.
 */
const SYSTEM = `You read a photo of a PHILIPPINE COMPANY CHECK (cheque) issued by AEROVENT FANS & BLOWERS MANUFACTURING to pay a supplier.

The fields on the check, and exactly what each one means:
- ACCOUNT NO. — the account the check is drawn on (printed top-left). Digits only, keep leading zeros.
- ACCOUNT NAME — the account holder. On our checks this is our own company, "AEROVENT FANS AND BLOWERS MANUFACTURING". Read what is printed, even if it is not us.
- CHECK NO. — the pre-printed check number (top-right, usually beside a BRSTN number). KEEP ALL LEADING ZEROS exactly as printed, e.g. "0000486722". Do NOT return the BRSTN / routing number (the one with dashes, e.g. "01053-313-0") as the check number.
- PAY TO THE ORDER OF — the payee, i.e. the supplier being paid. Return the company name as printed.
- DATE — the boxed date, usually as MM-DD-YYYY in separate character boxes (e.g. 1 0 - 1 7 - 2 0 2 6 = 17 October 2026). THIS IS THE DATE THE CHECK CLEARS, not the date it was written — company checks here are commonly post-dated, so a date weeks or months in the future is normal and must be read as printed. Return it as YYYY-MM-DD.
- AMOUNT IN FIGURES — the number in the box beside the "P" peso sign, e.g. "20,827.37".
- AMOUNT IN WORDS — the line above "PESOS", spelled out, e.g. "TWENTY THOUSAND EIGHT HUNDRED TWENTY SEVEN AND 37/100". Return it VERBATIM as printed.

CRITICAL RULES:
- Read the amount in figures and the amount in words INDEPENDENTLY. Do NOT correct one to match the other, and do NOT compute either from the other. If they disagree, return both exactly as printed and add a warning — the disagreement is the useful signal.
- The MICR line along the bottom (the machine-readable digits between symbols) repeats the check number, the routing number and the account number. Use it to CONFIRM the check number and account number you read from the printed fields; if the two disagree, trust the printed field and add a warning.
- IGNORE anything handwritten in the margins, any paper clip, stamp, staple or annotation lying on top of the check, and any other document visible behind or beside it.
- If this image is NOT a check (a deposit slip, a receipt, an invoice, a voucher), set isCheck=false, leave the fields null, and say so in a warning.
- ACCURACY OVER COMPLETENESS. If the photo is blurry, has glare, is cropped, or you are not highly sure of the EXACT digits, set a LOW confidence, leave that field null, and add a warning. NEVER guess, approximate or invent a number, a date or a name.
- Amounts are Philippine pesos; ignore the "₱"/"P"/"PHP" symbol and thousands separators, and return a plain number.
Return STRICT JSON only.`;

const USER_PROMPT = `From the attached photo of a check, return JSON with this exact shape:
{
  "accountNo": string|null,     // Account No., digits only, leading zeros kept
  "accountName": string|null,   // Account Name as printed
  "checkNo": string|null,       // Check No. as printed, leading zeros kept (NOT the BRSTN)
  "payee": string|null,         // Pay to the order of — the supplier
  "date": string|null,          // YYYY-MM-DD from the DATE boxes (the clearing date; may be in the future)
  "amount": number|null,        // the figure in the peso box
  "amountWords": string|null,   // the PESOS line, verbatim
  "bank": string|null,          // the drawee bank if shown (e.g. "BDO")
  "isCheck": boolean,           // false if this image is not a check
  "confidence": number,         // 0..1 — how sure you are of the EXACT digits
  "warnings": [ string ]        // e.g. "figures and words disagree", "glare over the date"
}`;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = isAdmin(user);
  const assignments = await getWorkflowRoles();
  const roles = (["accounting", "payment_approver"] as WorkflowRoleKey[]).filter((r) => userHasWorkflowRole(assignments, user.id, r));
  // Reading a check is the same audience as attaching one — it is the same act.
  if (!canAttachCheck({ admin, workflowRoles: roles })) {
    return NextResponse.json({ error: "Only Accounting, the Payment Approver or an admin can read a check." }, { status: 403 });
  }
  // The file must belong to this purchase request.
  if (!body.path.startsWith(`purchases/${body.purchaseRequestId}/`)) {
    return NextResponse.json({ error: "That file doesn't belong to this purchase order." }, { status: 400 });
  }

  const pr = await prisma.purchaseRequest.findUnique({
    where: { id: body.purchaseRequestId },
    select: { id: true, po: true, quotationId: true, voucherCheckDocs: true },
  });
  if (!pr) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

  const docs = coerceCheckDocs(pr.voucherCheckDocs);
  const target = docs.find((d) => d.path === body.path);
  if (!target) return NextResponse.json({ error: "That check isn't attached to this purchase order." }, { status: 404 });

  // The Payment Approver overrides the limit alongside the admin: they are the
  // one authorising the money, so they are never locked out of looking at it.
  const unlimited = admin || roles.includes("payment_approver");
  const reads = docs.reduce((n, d) => n + (d.read ? 1 : 0), 0);
  if (!unlimited && reads >= AI_CHECK_READ_LIMIT) {
    return NextResponse.json({
      error: `AI read limit reached (${AI_CHECK_READ_LIMIT} of ${AI_CHECK_READ_LIMIT} used for this PO). Check the figures against the check by hand — or ask an admin.`,
      limitReached: true,
      reads,
      limit: AI_CHECK_READ_LIMIT,
    }, { status: 429 });
  }

  const content: ContentBlock[] = [];
  try {
    const { base64, contentType } = await downloadFromStorage(body.path);
    if (IMAGE_TYPES.has(contentType)) {
      let mediaType = contentType;
      let data = base64;
      try {
        const out = await sharp(Buffer.from(base64, "base64"))
          .rotate()
          .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        data = out.toString("base64");
        mediaType = "image/jpeg";
      } catch { /* fall back to the original bytes */ }
      content.push({ type: "image", image: { mediaType, base64: data } });
    } else if (contentType === "application/pdf" || body.path.toLowerCase().endsWith(".pdf")) {
      content.push({ type: "document", document: { base64 } });
    } else {
      return NextResponse.json({ error: "Check reading supports photos (JPG, PNG) and PDFs only." }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't open the uploaded file." }, { status: 502 });
  }
  content.push({ type: "text", text: USER_PROMPT });

  try {
    const r = await callClaudeJson({ system: SYSTEM, content, schema: checkReadSchema, maxTokens: 1200 });

    const read: CheckRead = {
      accountNo: r.accountNo ?? null,
      accountName: r.accountName ?? null,
      checkNo: r.checkNo ?? null,
      payee: r.payee ?? null,
      clearingYMD: r.date ?? null,
      amount: r.amount ?? null,
      amountWords: r.amountWords ?? null,
      bank: r.bank ?? null,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      warnings: [...(r.warnings ?? []), ...(r.isCheck ? [] : ["This image doesn't look like a check."])],
      issues: [], // filled in below, once the read is cross-examined
      readByName: user.name,
      readAt: new Date().toISOString(),
    };

    // Cross-examine the read against what the system already knows. Every check
    // number recorded on ANY OTHER purchase order counts as used, so the same
    // check can't quietly pay two POs.
    const po = coercePurchaseOrder(pr.po);
    const others = await prisma.purchaseRequest.findMany({
      where: { id: { not: pr.id } },
      select: { voucherCheckDocs: true },
    });
    const usedCheckNos = others.flatMap((o) => coerceCheckDocs(o.voucherCheckDocs).map((d) => d.read?.checkNo ?? "")).filter(Boolean);

    const issues = checkIssues({
      read,
      supplierCompany: po?.supplier.company ?? "",
      netAmount: po ? poTotals(po).net : 0,
      ourCompany: COMPANY.name,
      usedCheckNos,
      inWords: pesoAmountInWords,
    });
    read.issues = issues;

    const next: CheckDoc[] = docs.map((d) => (d.path === body.path ? { ...d, read } : d));
    await prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: { voucherCheckDocs: next as unknown as Prisma.InputJsonValue },
    });

    return NextResponse.json({
      read,
      issues,
      reads: unlimited ? reads : reads + 1,
      limit: unlimited ? null : AI_CHECK_READ_LIMIT,
    });
  } catch (err) {
    console.error("read-check error", err);
    const detail = err instanceof Error ? err.message : String(err);
    let error: string;
    if (/(ANTHROPIC_API_KEY|OPENROUTER_API_KEY) is not set/i.test(detail)) {
      error = "The AI key isn't set on the server. Add it to your hosting environment variables and redeploy — the check is still attached.";
    } else if (/model/i.test(detail) && /(not_found|404|does not exist|invalid)/i.test(detail)) {
      error = `The configured AI model isn't valid (${detail}). Set the model env var to a current model and redeploy.`;
    } else if (/credit|insufficient|balance|quota|payment/i.test(detail)) {
      error = `The AI account has no credit / billing isn't set up (${detail}). Top up the provider account, then retry.`;
    } else if (/401|403|authentication|invalid x-api-key|permission/i.test(detail)) {
      error = "The AI key was rejected (authentication error). Check the key is correct and active.";
    } else {
      error = `Could not read the check: ${detail}. The photo is still attached.`;
    }
    return NextResponse.json({ error }, { status: 502 });
  }
}
