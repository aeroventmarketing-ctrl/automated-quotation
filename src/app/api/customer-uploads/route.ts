import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { accountHolderId } from "@/lib/account";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { bir2303Access } from "@/lib/bir2303-access";
import { bir2303Prefix } from "@/lib/bir2303";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED = /\.(pdf|jpe?g|png|webp|gif|heic)$/i;

/**
 * Upload a client's BIR Form 2303 to storage under `customers/{id}/bir2303/` and
 * return its path. The caller records it with `attachBir2303` — this only stores
 * the bytes. The client's sales account holder, Accounting, the Payment Approver
 * and Admin (`bir2303Access().canEdit`).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const customerId = form.get("customerId") as string | null;
  if (!file || !customerId) return NextResponse.json({ error: "file and customerId are required" }, { status: 400 });
  const [roles, holder] = await Promise.all([getWorkflowRoles(), accountHolderId(customerId)]);
  if (!bir2303Access(user, roles, holder).canEdit) {
    return NextResponse.json({ error: "Only the client's sales account holder, Accounting, the Payment Approver or an admin can upload this BIR 2303." }, { status: 403 });
  }
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json({ error: "Upload the BIR 2303 as a PDF or a photo (JPG / PNG)." }, { status: 415 });
  }

  try {
    const ext = file.name.split(".").pop()!.toLowerCase();
    const path = `${bir2303Prefix(customerId)}${Date.now()}-${Math.round(performance.now())}.${ext}`;
    await uploadToStorage(path, new Uint8Array(await file.arrayBuffer()), file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("customer upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Upload failed: ${detail}` }, { status: 502 });
  }
}

/**
 * The eye: GET ?path=… → a short-lived signed URL, shown inline (PDFs and
 * photos render in the browser). Add &download=1 to save it instead.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path") ?? "";
  const m = /^customers\/([^/]+)\/bir2303\/[^/]+$/.exec(path);
  if (!m) return NextResponse.json({ error: "Not a client document." }, { status: 400 });
  const [roles, holder] = await Promise.all([getWorkflowRoles(), accountHolderId(m[1])]);
  if (!bir2303Access(user, roles, holder).canView) {
    return NextResponse.json({ error: "You don't have permission to view this document." }, { status: 403 });
  }
  const download = req.nextUrl.searchParams.get("download") !== null ? (req.nextUrl.searchParams.get("name") ?? true) : undefined;
  try {
    return NextResponse.redirect(await signedUrl(path, 120, download));
  } catch (err) {
    console.error("customer document open error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
