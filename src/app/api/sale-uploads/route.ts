import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Upload a sale document (PO or proof of payment) to Supabase Storage and return
 * its storage path + original name. The caller records the path on the quote's
 * sale (via the recordSale action); no Attachment row is created.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const quotationId = form.get("quotationId") as string | null;
  if (!file || !quotationId) {
    return NextResponse.json({ error: "file and quotationId are required" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const ext = file.name.split(".").pop() || "bin";
    const path = `sales/${quotationId}/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from(config.storageBucket)
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (error) throw error;
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("sale upload error", err);
    return NextResponse.json(
      { error: "Upload failed. Verify the Supabase Storage bucket exists and the service role key is set." },
      { status: 502 },
    );
  }
}

/** GET ?path=... → redirect to a short-lived signed URL for the stored file. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.storage.from(config.storageBucket).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
    return NextResponse.redirect(data.signedUrl);
  } catch (err) {
    console.error("sale download error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
