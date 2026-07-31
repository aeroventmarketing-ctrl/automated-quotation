/**
 * Inbound-email webhook — drops a received client reply into the RFQ review queue.
 *
 * Auth: requires INBOUND_WEBHOOK_SECRET as the `x-inbound-secret` header (or
 * `?key=`). When the secret is unset the endpoint refuses to run.
 *
 * Contract (normalized): POST JSON
 *   { fromEmail, fromName?, subject?, text?, attachments?: [{ name, url }] }
 *
 * NOTE ON RESEND: Resend's inbound webhook posts its own event shape and only
 * includes metadata — the body + attachments are fetched via Resend's Received
 * Emails / Attachments API. Point Resend at this endpoint through a small adapter
 * (verify the Svix signature, fetch the message + attachments, map to the shape
 * above). That adapter is finalized once the inbound domain is live; this handler
 * is the stable target it feeds.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { addInboundItem } from "@/lib/inbound-rfq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).max(20).optional(),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return false; // never run unauthenticated
  if (req.headers.get("x-inbound-secret") === secret) return true;
  return req.nextUrl.searchParams.get("key") === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await addInboundItem({
    id: randomUUID(),
    fromEmail: body.fromEmail.trim().toLowerCase(),
    fromName: body.fromName?.trim() || undefined,
    subject: body.subject?.trim() || undefined,
    text: body.text ?? undefined,
    attachments: body.attachments ?? [],
    receivedAt: new Date().toISOString(),
    status: "pending",
  });

  return NextResponse.json({ ok: true });
}
