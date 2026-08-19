import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Store product photos (Phase A of store ⇄ ERP unification). Admins upload a
 * product image to Supabase Storage under store/…; the catalogue item's
 * `storePhotos` array stores the returned path. GET previews it via a short-lived
 * signed URL for the admin's browser. Scoped to the store/ prefix. Admin only.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image files are allowed." }, { status: 400 });

  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `store/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("store upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload failed: ${detail}. Check the Supabase Storage bucket and the service role key.` },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!path.startsWith("store/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.redirect(await signedUrl(path, 300));
  } catch (err) {
    console.error("store image error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
