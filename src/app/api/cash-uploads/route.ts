import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Upload a cash-request document (e.g. a receipt for liquidation) to Supabase
 * Storage and return its path + original name. Stored under cashrequests/<id>/…;
 * the caller records the path on the cash request (via recordCashLiquidation).
 * Internal-only — any authenticated staff member can upload and view.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const cashRequestId = form.get("cashRequestId") as string | null;
  if (!file || !cashRequestId) {
    return NextResponse.json({ error: "file and cashRequestId are required" }, { status: 400 });
  }

  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `cashrequests/${cashRequestId}/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("cash upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload failed: ${detail}. Check the Supabase Storage bucket and the service role key.` },
      { status: 502 },
    );
  }
}

/**
 * GET ?path=… → redirect to a short-lived signed URL for the stored file.
 * Add ?download=1 (optionally &name=…) to force a download. Restricted to the
 * cashrequests/ scope so only cash-request documents are served.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!path.startsWith("cashrequests/")) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wantsDownload = req.nextUrl.searchParams.get("download") !== null;
  const name = req.nextUrl.searchParams.get("name");
  const download = wantsDownload ? (name ?? true) : undefined;
  try {
    return NextResponse.redirect(await signedUrl(path, 120, download));
  } catch (err) {
    console.error("cash download error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
