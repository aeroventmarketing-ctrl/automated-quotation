import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadToStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Upload a photo / spec sheet to Supabase Storage and record an Attachment.
 * Used by the inquiry detail page to attach the original document.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const inquiryId = form.get("inquiryId") as string | null;
  const kind = (form.get("kind") as string | null) ?? "PHOTO";

  if (!file || !inquiryId) {
    return NextResponse.json({ error: "file and inquiryId are required" }, { status: 400 });
  }

  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `inquiries/${inquiryId}/${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);

    const attachment = await prisma.attachment.create({
      data: { inquiryId, storagePath: path, kind: kind as never },
    });

    return NextResponse.json({ attachment });
  } catch (err) {
    console.error("upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Upload failed: ${detail}. Check the Supabase Storage bucket and the service role key.` },
      { status: 502 },
    );
  }
}
