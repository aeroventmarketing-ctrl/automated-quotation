import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { canUseEwtSummary } from "@/lib/ewt-access";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Proofs of payment to BIR for the EWT Summary — stored under ewt/<kind>/…, and
 * only for the people who use that report (admin, Payment Approver, Accounting).
 * POST returns { path, name, uploadedAt }; the page then records it on its row(s).
 */
async function allowed(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  return canUseEwtSummary(user, await getWorkflowRoles());
}

export async function POST(req: NextRequest) {
  if (!(await allowed())) return NextResponse.json({ error: "Only an admin, the Payment Approver or Accounting can upload here." }, { status: 403 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const kind = form.get("kind");
  if (!file || (kind !== "supplier" && kind !== "client")) return NextResponse.json({ error: "file and kind are required" }, { status: 400 });
  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `ewt/${kind}/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    await uploadToStorage(path, new Uint8Array(await file.arrayBuffer()), file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("ewt upload error", err);
    return NextResponse.json({ error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}

/** GET ?path=… → a short-lived signed URL (add &download=1 to download). */
export async function GET(req: NextRequest) {
  if (!(await allowed())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("ewt/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = req.nextUrl.searchParams.get("name");
  const download = req.nextUrl.searchParams.get("download") !== null ? (name ?? true) : undefined;
  try {
    return NextResponse.redirect(await signedUrl(path, 120, download));
  } catch (err) {
    console.error("ewt download error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
