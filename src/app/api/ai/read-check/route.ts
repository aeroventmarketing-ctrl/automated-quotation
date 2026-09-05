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
import { canAttachCheck, checkReadableAt, clearingFromDateBoxes, coerceCheckDocs, checkIssues, type CheckDoc, type CheckRead } from "@/lib/voucher-check";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { isDeptRequisition, isPoApproved, type PRStatus } from "@/lib/purchasing";
import { pesoAmountInWords, pesoAmountFromWords } from "@/lib/amount-words";
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
 *
 * Neither the date nor the amount is left to the model's arithmetic. It
 * transcribes what is printed — the eight DATE-box digits, the PESOS line — and
 * both are turned into values HERE, where the rules are rules: MM DD YYYY for
 * the date, and for the amount the written line over the peso box, because that
 * is the one a transposed digit cannot quietly corrupt.
 */
const SYSTEM = `You read a photo of a PHILIPPINE COMPANY CHECK (cheque) issued by AEROVENT FANS & BLOWERS MANUFACTURING to pay a supplier.

The fields on the check, and exactly what each one means:
- ACCOUNT NO. — the account the check is drawn on (printed top-left). Digits only, keep leading zeros.
- ACCOUNT NAME — the account holder. On our checks this is our own company, "AEROVENT FANS AND BLOWERS MANUFACTURING". Read what is printed, even if it is not us.
- CHECK NO. — the pre-printed check number (top-right, usually beside a BRSTN number). It is TEN DIGITS INCLUDING LEADING ZEROS, e.g. "0000486722" — six significant digits padded with zeros. Return all ten; do NOT strip the leading zeros and do not return only the significant digits. Do NOT return the BRSTN / routing number (the one with dashes, e.g. "01053-313-0") as the check number.
- PAY TO THE ORDER OF — the payee, i.e. the supplier being paid. Return the company name as printed.
- DATE — eight digits in separate character boxes at the top right, with the order printed underneath them as "M M  D D  Y Y Y Y". READ THE POSITIONS, NOT THE VALUES: the first two digits are the MONTH, the next two are the DAY, the last four are the YEAR — ALWAYS, including when both could plausibly be either.
  - "1 0 0 4 2 0 2 6" is 4 OCTOBER 2026 (month 10, day 04). It is NOT 10 April 2026.
  - "0 3 1 1 2 0 2 6" is 11 MARCH 2026. It is NOT 3 November 2026.
  - "1 0 1 7 2 0 2 6" is 17 OCTOBER 2026.
  Return the eight digits themselves in "dateDigits", exactly as they sit in the boxes left to right and with their leading zeros (e.g. "10042026"), AND the same date as YYYY-MM-DD in "date". ALWAYS fill in "dateDigits" when you can see the date at all — it is what the clearing date is actually built from, and a date given WITHOUT it is recorded as unconfirmed and has to be checked by a person. Set it to null only if the digits are genuinely unreadable, or the date is handwritten free-hand rather than sitting in boxes.
  THIS IS THE DATE THE CHECK CLEARS, not the date it was written — company checks here are commonly post-dated, so a date weeks or months in the future is normal and must be read as printed.
- AMOUNT IN FIGURES — the number in the box beside the "P" peso sign, e.g. "20,827.37". Read it ONE DIGIT AT A TIME, left to right, and keep them in that order. Do not "recognise" a familiar-looking number and write it from memory: "2,081.25" and "2,018.25" differ by two digits changing places, and a check for the wrong one is a real payment to a supplier.
- AMOUNT IN WORDS — the line above "PESOS", spelled out, e.g. "TWENTY THOUSAND EIGHT HUNDRED TWENTY SEVEN AND 37/100". Return it VERBATIM as printed, including however the line is closed. On these checks a whole-peso amount ends with the word "ONLY" ("TWO THOUSAND ONE HUNDRED EIGHTY PESOS ONLY") where other checks would write "AND 00/100" — do NOT convert one into the other, and do not drop a trailing "ONLY", asterisks or filler characters. Copy the line.

CRITICAL RULES:
- NEVER swap the month and the day. A Philippine company check is MONTH first. If you find yourself reasoning about which number "looks more like a day", stop: the box order decides, and the digits you put in "dateDigits" are what will be used.
- Read the amount in figures and the amount in words INDEPENDENTLY. Do NOT correct one to match the other, and do NOT compute either from the other. If they disagree, return both exactly as printed and add a warning — the disagreement is the useful signal, and the PESOS line is what will be used (on a check the written amount governs), so transcribe that line with particular care.
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
  "checkNo": string|null,       // Check No. as printed — all 10 digits, leading zeros kept (NOT the BRSTN)
  "payee": string|null,         // Pay to the order of — the supplier
  "dateDigits": string|null,    // the 8 DATE-box digits as printed, left to right: MMDDYYYY, e.g. "10042026"
  "date": string|null,          // the same date as YYYY-MM-DD (the clearing date; may be in the future)
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
    select: { id: true, po: true, quotationId: true, voucherCheckDocs: true, status: true, chainLog: true, kind: true, mrfId: true },
  });
  if (!pr) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  // Reading follows the ATTACH window for everyone except an admin, who may
  // re-read at any stage — reading fills in what the photo says and moves no
  // money. See `checkReadableAt`.
  if (!checkReadableAt(
    pr.status as PRStatus,
    { isDept: isDeptRequisition(pr), poApproved: isPoApproved(pr.chainLog) },
    { admin, paymentApprover: roles.includes("payment_approver"), accounting: roles.includes("accounting") },
  )) {
    return NextResponse.json({
      error: pr.status === "COMPLETED"
        ? "This purchase order is completed — only Accounting, the Payment Approver or an admin can re-read its check now."
        : "A check can only be read once the voucher & check are signed (the Budgeted tab).",
    }, { status: 409 });
  }

  const docs = coerceCheckDocs(pr.voucherCheckDocs);
  const target = docs.find((d) => d.path === body.path);
  if (!target) return NextResponse.json({ error: "That check isn't attached to this purchase order." }, { status: 404 });

  /**
   * Record WHY a read failed, on the check itself.
   *
   * Without this the error reached the browser and died there, leaving
   * "Check number not read" to mean both *the AI couldn't* and *nobody tried* —
   * and on a PO that has since completed, no way to tell which. Best-effort: a
   * failure to record a failure must not replace the real error.
   */
  const recordFailure = async (message: string) => {
    try {
      const next: CheckDoc[] = docs.map((d) => (d.path === body.path
        ? { ...d, readError: { message, at: new Date().toISOString(), byName: user.name } }
        : d));
      await prisma.purchaseRequest.update({
        where: { id: pr.id },
        data: { voucherCheckDocs: next as unknown as Prisma.InputJsonValue },
      });
    } catch { /* the error below is the one that matters */ }
  };

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
      const error = "Check reading supports photos (JPG, PNG) and PDFs only.";
      await recordFailure(error);
      return NextResponse.json({ error }, { status: 422 });
    }
  } catch {
    const error = "Couldn't open the uploaded file.";
    await recordFailure(error);
    return NextResponse.json({ error }, { status: 502 });
  }
  content.push({ type: "text", text: USER_PROMPT });

  try {
    const r = await callClaudeJson({ system: SYSTEM, content, schema: checkReadSchema, maxTokens: 1200 });

    // The DATE boxes are labelled M M D D Y Y Y Y, so the clearing date is
    // ASSEMBLED HERE from the digits the model transcribed rather than taken
    // from the date it wrote out. Asking for a date is what let 10-04-2026 come
    // back as 10 April; transcribing eight digits has no such judgement in it.
    const boxes = r.dateDigits ?? null;
    const fromBoxes = clearingFromDateBoxes(boxes);
    const modelDate = r.date ?? null;
    const dateWarnings = fromBoxes && modelDate && modelDate !== fromBoxes
      ? [`Date boxes read ${boxes} = ${fromBoxes} (MM DD YYYY); the model wrote ${modelDate}. Using the boxes.`]
      : [];

    // The amount, likewise, is taken from the line that cannot be transposed.
    // A photo of "2,081.25" comes back as "2,018.25" if two digits change
    // places and nothing about the result looks wrong; "EIGHTY-ONE" does not
    // turn into "EIGHTEEN". The law says the same — under the Negotiable
    // Instruments Law (Act 2031, sec. 17(c)) the sum in WORDS is the sum
    // payable when the two disagree.
    // All three are kept apart — the peso box, the words, and (on the card) the
    // PO's net — so `checkIssues` can say WHICH pair disagrees rather than that
    // "the amounts don't match".
    const figures = r.amount ?? null;
    const fromWords = pesoAmountFromWords(r.amountWords ?? null);
    const disagree = fromWords != null && figures != null && Math.abs(fromWords - figures) > 0.005;
    const amountWarnings = disagree
      ? [`Peso box read ${figures}, the words read ${fromWords}. The written amount governs, so the words were used.`]
      : [];

    const read: CheckRead = {
      accountNo: r.accountNo ?? null,
      accountName: r.accountName ?? null,
      checkNo: r.checkNo ?? null,
      payee: r.payee ?? null,
      // Boxes win; the model's own date only stands when there were no boxes to read.
      clearingYMD: fromBoxes ?? modelDate,
      dateBoxes: boxes,
      amount: fromWords ?? figures,
      amountFigures: figures,
      amountFromWords: fromWords,
      amountWords: r.amountWords ?? null,
      bank: r.bank ?? null,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      warnings: [...(r.warnings ?? []), ...dateWarnings, ...amountWarnings, ...(r.isCheck ? [] : ["This image doesn't look like a check."])],
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

    // A read that worked erases the note about the one that didn't.
    const next: CheckDoc[] = docs.map((d) => {
      if (d.path !== body.path) return d;
      const { readError: _cleared, ...rest } = d;
      return { ...rest, read };
    });
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
    await recordFailure(error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
