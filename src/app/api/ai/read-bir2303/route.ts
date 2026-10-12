import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { downloadFromStorage } from "@/lib/storage";
import { callClaudeJson, type ContentBlock } from "@/lib/ai/client";
import { bir2303ReadSchema } from "@/lib/ai/schemas";
import { AI_BIR2303_READ_LIMIT } from "@/lib/ai/limits";
import { coerceReadCounts, readsUsed, readsLeft, canReadAgain, bumpReadCount } from "@/lib/ai/read-allowance";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { getAccountData, updateAccountsRegistry } from "@/lib/account";
import { bir2303Access } from "@/lib/bir2303-access";
import { BIR2303_SYSTEM, BIR2303_USER_PROMPT, fieldsFromRead, isBir2303Path } from "@/lib/bir2303";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ customerId: z.string().min(1) });
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Read the client's uploaded BIR 2303 and return the five fields for the form.
 *
 * It does NOT save them. The values go into the editor for a person to check
 * against the certificate (the eye is beside it) and save — the AI fills the
 * boxes; someone still signs for them. Only the read count is written.
 *
 * The file read is the one on the client's record, never a path from the
 * browser, so this can only ever read that client's own certificate.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!bir2303Access(user, await getWorkflowRoles()).canEdit) {
    return NextResponse.json({ error: "Only Sales, Accounting or an admin can read a BIR 2303." }, { status: 403 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const account = await getAccountData(body.customerId);
  const doc = account?.bir2303?.doc;
  if (!doc || !isBir2303Path(body.customerId, doc.path)) {
    return NextResponse.json({ error: "Upload the BIR 2303 first." }, { status: 400 });
  }

  const unlimited = isAdmin(user);
  const counts = coerceReadCounts(account?.bir2303?.readCounts);
  if (!canReadAgain(counts, doc.path, AI_BIR2303_READ_LIMIT, { unlimited })) {
    return NextResponse.json({
      error: `This BIR 2303 has already been read ${AI_BIR2303_READ_LIMIT} times — that is the limit per file. Type the fields from the certificate, or ask an admin. A clearer copy, uploaded, gets its own ${AI_BIR2303_READ_LIMIT}.`,
      limitReached: true,
    }, { status: 429 });
  }

  const content: ContentBlock[] = [];
  try {
    const { base64, contentType } = await downloadFromStorage(doc.path);
    if (IMAGE_TYPES.has(contentType)) {
      let mediaType = contentType;
      let data = base64;
      try {
        // A 2303 is dense small print over a security pattern — keep the long edge
        // at the model's maximum so the TIN digits survive the resize.
        const out = await sharp(Buffer.from(base64, "base64"))
          .rotate()
          .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        data = out.toString("base64");
        mediaType = "image/jpeg";
      } catch { /* fall back to the original bytes */ }
      content.push({ type: "image", image: { mediaType, base64: data } });
    } else if (contentType === "application/pdf" || doc.path.toLowerCase().endsWith(".pdf")) {
      content.push({ type: "document", document: { base64 } });
    } else {
      return NextResponse.json({ error: "AI reading supports photos (JPG, PNG) and PDFs only — type the fields in by hand." }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't open the uploaded file." }, { status: 502 });
  }
  content.push({ type: "text", text: BIR2303_USER_PROMPT });

  try {
    const r = await callClaudeJson({ system: BIR2303_SYSTEM, content, schema: bir2303ReadSchema, maxTokens: 800 });
    const { fields, warnings } = fieldsFromRead(r);
    const nextCounts = bumpReadCount(counts, doc.path, { unlimited });
    await updateAccountsRegistry((accounts) => {
      const existing = accounts[body.customerId] ?? { history: [], conversations: [] };
      accounts[body.customerId] = { ...existing, bir2303: { ...(existing.bir2303 ?? {}), readCounts: nextCounts } };
    });
    return NextResponse.json({
      fields,
      warnings,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      reads: readsUsed(nextCounts, doc.path),
      remaining: readsLeft(nextCounts, doc.path, AI_BIR2303_READ_LIMIT, { unlimited }),
    });
  } catch (err) {
    console.error("read-bir2303 error", err);
    const detail = err instanceof Error ? err.message : String(err);
    const error = /(ANTHROPIC_API_KEY|OPENROUTER_API_KEY) is not set/i.test(detail)
      ? "The AI key isn't set on the server — type the fields in from the certificate."
      : `Could not read the BIR 2303: ${detail}. You can type the fields in by hand.`;
    return NextResponse.json({ error }, { status: 502 });
  }
}
