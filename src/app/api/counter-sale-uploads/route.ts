import { NextRequest, NextResponse } from "next/server";
import { getCounterSaleViewer } from "@/lib/counter-sale-access";
import { uploadToStorage, signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Upload a counter-sale document (Sales Invoice / Collection Receipt / Delivery
 * Receipt / Delivery Form / Acknowledgement Form / BIR 2307) to Supabase Storage
 * and return its storage path + original name. Stored under
 * counter-sales/<saleId>/…; the caller records the path on the sale.
 */
export async function POST(req: NextRequest) {
  const { allowed } = await getCounterSaleViewer();
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const saleId = (form.get("counterSaleId") as string | null) ?? (form.get("saleId") as string | null);
  if (!file || !saleId) {
    return NextResponse.json({ error: "file and counterSaleId are required" }, { status: 400 });
  }
  try {
    const ext = file.name.split(".").pop() || "bin";
    const path = `counter-sales/${saleId}/${Date.now()}-${Math.round(performance.now())}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadToStorage(path, bytes, file.type);
    return NextResponse.json({ path, name: file.name, uploadedAt: new Date().toISOString() });
  } catch (err) {
    console.error("counter-sale upload error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Upload failed: ${detail}` }, { status: 502 });
  }
}

/**
 * GET ?path=… → redirect to a short-lived signed URL for the stored file. Add
 * ?download=1 (optionally &name=…) to force a download instead of viewing inline.
 */
export async function GET(req: NextRequest) {
  const { allowed } = await getCounterSaleViewer();
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("counter-sales/")) return NextResponse.json({ error: "path is required" }, { status: 400 });
  const wantsDownload = req.nextUrl.searchParams.get("download") !== null;
  const name = req.nextUrl.searchParams.get("name");
  const download = wantsDownload ? (name ?? true) : undefined;
  try {
    return NextResponse.redirect(await signedUrl(path, 120, download));
  } catch (err) {
    console.error("counter-sale download error", err);
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
