import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Upload a stock-transfer proof (delivery note / photo) to Supabase Storage and
 * return its path + name. The caller records it on the transfer via
 * attachTransferProof. Paths are "transfers/<transferId>/...".
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const transferId = form.get("transferId") as string | null;
  if (!file || !transferId) return NextResponse.json({ error: "file and transferId are required" }, { status: 400 });

  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `transfers/${transferId}/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Upload failed: ${detail}. Check the Supabase Storage bucket and service role key.` }, { status: 502 });
  }
}

/** GET ?path=... → signed URL (add ?download=1 to download). Transfer proofs only. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("transfers/")) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  const wantsDownload = req.nextUrl.searchParams.get("download") !== null;
  const name = req.nextUrl.searchParams.get("name");
  const download = wantsDownload ? (name ?? true) : undefined;
  try {
    return NextResponse.redirect(await signedUrl(path, 120, download));
  } catch {
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
