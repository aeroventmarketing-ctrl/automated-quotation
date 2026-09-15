import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { uploadToStorage, signedUrl } from "@/lib/storage";
import { canAttachCommissionProof, canViewCommissionProof, proofPathPrefix } from "@/lib/commission-proof";

export const runtime = "nodejs";
export const maxDuration = 30;

/** The viewer's identity as the two rules below need it. */
async function viewerFor(req: NextRequest) {
  void req;
  const user = await getCurrentUser();
  if (!user) return null;
  const assignments = await getWorkflowRoles();
  const workflowRoles = WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey));
  return { id: user.id, name: user.name, admin: isAdmin(user), workflowRoles };
}

/**
 * Upload a commission payout's proof of payment — the deposit slip or transfer
 * screenshot. Accounting, the Payment Approver or an admin (`canAttachCommissionProof`).
 *
 * Stored under `commissions/<salespersonId>/…`, which is not decoration: the GET
 * below decides whether the caller may open a file by reading the payee's id out
 * of the path, so a file cannot be served to the wrong person even if the record
 * that pointed at it were wrong.
 */
export async function POST(req: NextRequest) {
  const viewer = await viewerFor(req);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAttachCommissionProof(viewer)) {
    return NextResponse.json({ error: "Only Accounting, the Payment Approver or an admin can attach proof of payment." }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const salespersonId = form.get("salespersonId") as string | null;
  if (!file || !salespersonId) {
    return NextResponse.json({ error: "file and salespersonId are required" }, { status: 400 });
  }

  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${proofPathPrefix(salespersonId)}${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);
    return NextResponse.json({
      path,
      name: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedById: viewer.id,
      uploadedByName: viewer.name,
    });
  } catch (err) {
    console.error("commission proof upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload failed: ${detail}. Check the Supabase Storage bucket and the service role key.` },
      { status: 502 },
    );
  }
}

/**
 * GET ?path=… → a short-lived signed URL for the file.
 *
 * The owner's requirement in one line: *"Proof of payment must be viewable by
 * sales account holder."* So this is the one document route in the app whose
 * permission is not a role at all — the payee may open the proof of their own
 * payment, and nobody else's, because the payee's id is part of the path.
 */
export async function GET(req: NextRequest) {
  const viewer = await viewerFor(req);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  // Scope first: this route serves commission proofs and nothing else in the bucket.
  if (!path.startsWith("commissions/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // "Not found", not "Forbidden": someone else's payout is none of their business,
  // including whether it exists.
  if (!canViewCommissionProof(viewer, path)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wantsDownload = req.nextUrl.searchParams.get("download") !== null;
  const name = req.nextUrl.searchParams.get("name");
  const download = wantsDownload ? (name ?? true) : undefined;
  try {
    return NextResponse.redirect(await signedUrl(path, 120, download));
  } catch (err) {
    console.error("commission proof download error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
