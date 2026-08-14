/**
 * Public RFQ intake — the "Request a Quotation" form on /rfq posts here.
 *
 * A client (NOT logged in) submits their contact details + RFQ file(s). We store
 * the files in the private bucket and drop a PENDING item into the Inbound RFQ
 * queue — the same place emailed RFQs land — so Sales reviews it and turns it into
 * an inquiry with the existing button. Nothing auto-creates an inquiry.
 *
 * Because it's public it's guarded: a honeypot field, a per-IP rate limit, and
 * strict file type/size/count limits. An optional ?c/&t prefill token attributes
 * the RFQ to a known client.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { uploadToStorage } from "@/lib/storage";
import { addInboundItem } from "@/lib/inbound-rfq";
import { verifyRfqToken } from "@/lib/rfq-link";
import { prisma } from "@/lib/db";
import { config, COMPANY } from "@/lib/config";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { sendSms, smsConfigured, normalizePhMobile } from "@/lib/sms/semaphore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// --- Limits ---------------------------------------------------------------
const MAX_FILES = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB each
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 40 MB per submission
const ALLOWED_EXT = new Set([
  "pdf", "jpg", "jpeg", "png", "webp", "gif", "heic",
  "xlsx", "xls", "csv", "doc", "docx", "ppt", "pptx",
  "dwg", "dxf", "zip", "rar", "7z", "txt",
]);

// --- Best-effort per-IP rate limit (in-memory sliding window) -------------
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return arr.length > MAX_PER_WINDOW;
}

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0].trim())
    || req.headers.get("x-real-ip")
    || "unknown";
}

function safeName(name: string): string {
  return (name || "file").replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  // Honeypot: real users never fill the hidden "website" field. If it's set,
  // pretend success (don't tell the bot) and drop the submission.
  if ((form.get("website") ?? "").toString().trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many submissions. Please try again in a few minutes." }, { status: 429 });
  }

  const str = (k: string) => (form.get(k) ?? "").toString().trim();
  const company = str("company");
  const contactName = str("contactName");
  const email = str("email");
  const phone = str("phone");
  const message = str("message");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }
  if (!company && !contactName) {
    return NextResponse.json({ error: "Please tell us your company or name." }, { status: 400 });
  }

  // Optional prefill token → attribute to a known client.
  const c = str("c");
  const t = str("t");
  let knownCustomerId: string | null = null;
  if (c && t && verifyRfqToken(c, t)) {
    const cust = await prisma.customer.findUnique({ where: { id: c }, select: { id: true } }).catch(() => null);
    knownCustomerId = cust?.id ?? null;
  }

  // Collect + validate files.
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Please attach at most ${MAX_FILES} files.` }, { status: 400 });
  }
  let total = 0;
  for (const f of files) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: `"${f.name}" is not an accepted file type.` }, { status: 400 });
    }
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${f.name}" is larger than 15 MB.` }, { status: 400 });
    }
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "The attachments total more than 40 MB. Please send fewer or smaller files." }, { status: 400 });
  }

  // Upload each file to the private bucket, then reference it by a staff-only
  // view link (the same shape the inbound queue renders).
  const id = randomUUID();
  const attachments: { name: string; url: string }[] = [];
  try {
    for (const f of files) {
      const clean = safeName(f.name);
      const path = `rfq-uploads/${id}/${randomUUID().slice(0, 8)}-${clean}`;
      const bytes = new Uint8Array(await f.arrayBuffer());
      await uploadToStorage(path, bytes, f.type || "application/octet-stream");
      attachments.push({
        name: f.name,
        url: `/api/rfq-uploads/view?path=${encodeURIComponent(path)}&name=${encodeURIComponent(f.name)}`,
      });
    }
  } catch {
    return NextResponse.json({ error: "We couldn't save your attachment. Please try again." }, { status: 502 });
  }

  const lines = [
    company ? `Company: ${company}` : null,
    contactName ? `Contact: ${contactName}` : null,
    phone ? `Phone: ${phone}` : null,
    knownCustomerId ? `Known client (matched from email link): ${knownCustomerId}` : null,
    "",
    message,
  ].filter((l): l is string => l != null);

  await addInboundItem({
    id,
    fromEmail: email.toLowerCase(),
    // The queue uses fromName as the client company when creating a new customer.
    fromName: company || contactName || undefined,
    subject: `Website RFQ${company ? ` — ${company}` : ""}`,
    text: `${lines.join("\n").trim()}\n\n[Submitted via the website RFQ form]`.trim(),
    attachments,
    receivedAt: new Date().toISOString(),
    status: "pending",
  });

  // Acknowledge the client on both channels (best-effort — a failure here must
  // never fail the submission, which is already safely queued above).
  await sendAcknowledgements({ email, phone, contactName, company });

  return NextResponse.json({ ok: true });
}

/** Email + SMS "we received your request" acknowledgement to the client. */
async function sendAcknowledgements(to: { email: string; phone: string; contactName: string; company: string }) {
  const who = to.contactName || to.company || "there";

  // --- Email ---
  if (emailConfigured() && config.followUpFromEmail) {
    try {
      const from = `${config.followUpFromName} <${config.followUpFromEmail}>`;
      const text = `Dear ${who},\n\nThank you for your request. We've received it and our engineering team will review it shortly. We'll get back to you at this email address with a quotation or any follow-up questions.\n\nBest regards,\n${COMPANY.name}\n${COMPANY.tagline}\n\nContact us:\nLandline: (02) 85619413\nSmart: 0928-948-0600 / 0999-664-9997\nGlobe: 0927-325-8887 / 0954-429-8999\nInfo / Technical: info@aeroventfbm.com\nSales: sales@aeroventfbm.com`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2933">
<p>Dear ${esc(who)},</p>
<p>Thank you for your request. We&rsquo;ve received it and our engineering team will review it shortly. We&rsquo;ll get back to you at this email address with a quotation or any follow-up questions.</p>
<p style="margin-top:18px">Best regards,<br><strong>${esc(COMPANY.name)}</strong><br><span style="color:#607080;font-size:12px">${esc(COMPANY.tagline)}</span></p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid #e2e8f0"><tr><td style="padding-top:12px;color:#607080;font-size:12px;line-height:1.7">
<div style="font-weight:700;color:#1f2933;margin-bottom:2px">Contact us</div>
<div><strong style="color:#1f2933">Landline:</strong> (02) 85619413</div>
<div><strong style="color:#1f2933">Smart:</strong> 0928-948-0600 / 0999-664-9997</div>
<div><strong style="color:#1f2933">Globe:</strong> 0927-325-8887 / 0954-429-8999</div>
<div style="margin-top:4px"><strong style="color:#1f2933">Info / Technical:</strong> info@aeroventfbm.com</div>
<div><strong style="color:#1f2933">Sales:</strong> sales@aeroventfbm.com</div>
</td></tr></table>
</div>`;
      await sendEmail({ from, to: to.email, subject: "We've received your request — Aerovent Fans & Blowers", text, html, replyTo: "sales@aeroventfbm.com" });
    } catch (e) {
      console.error("rfq ack email failed", e);
    }
  }

  // --- SMS (Philippine mobiles only) ---
  const mobile = normalizePhMobile(to.phone);
  if (mobile && smsConfigured()) {
    try {
      await sendSms({ to: mobile, message: "Aerovent Fans & Blowers: We've received your quotation request and our team will get back to you shortly. Thank you!" });
    } catch (e) {
      console.error("rfq ack sms failed", e);
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
