import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Upload a calendar-event attachment to Supabase Storage (scoped to schedules/). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const scheduleId = (form.get("scheduleId") as string | null) || "misc";
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `schedules/${scheduleId}/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    await uploadToStorage(path, new Uint8Array(await file.arrayBuffer()), file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}

/** GET ?path=… → redirect to a short-lived signed URL. ?download=1 to download. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!path.startsWith("schedules/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wantsDownload = req.nextUrl.searchParams.get("download") !== null;
  const name = req.nextUrl.searchParams.get("name");
  try {
    return NextResponse.redirect(await signedUrl(path, 120, wantsDownload ? (name ?? true) : undefined));
  } catch {
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
