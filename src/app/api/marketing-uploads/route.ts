import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Only marketers upload campaign images. */
function canMarket(user: SessionUser | null): boolean {
  return !!user && (isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER");
}

/**
 * Upload a marketing-campaign image (hero / gallery / product tile) to Supabase
 * Storage under marketing/…, returning its path + original name. The campaign
 * draft stores the path; at send time it's resolved to a long-lived signed URL so
 * recipients' mail clients can load it.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!canMarket(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image files are allowed." }, { status: 400 });

  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `marketing/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("marketing upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload failed: ${detail}. Check the Supabase Storage bucket and the service role key.` },
      { status: 502 },
    );
  }
}

/**
 * GET ?path=… → redirect to a short-lived signed URL, for the in-app builder
 * preview / thumbnails (the authenticated marketer's browser). Restricted to the
 * marketing/ scope.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!canMarket(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!path.startsWith("marketing/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.redirect(await signedUrl(path, 300));
  } catch (err) {
    console.error("marketing image error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
