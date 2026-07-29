import { NextRequest, NextResponse } from "next/server";
import { getCounterSaleViewer } from "@/lib/counter-sale-access";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * View a stored counter-sale document inline (PDFs and images render natively in
 * the browser via a short-lived signed URL). Access-gated to counter-sale users.
 */
export async function GET(req: NextRequest) {
  const { allowed } = await getCounterSaleViewer();
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("counter-sales/")) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (req.nextUrl.searchParams.get("download") !== null) {
    const name = req.nextUrl.searchParams.get("name");
    try {
      return NextResponse.redirect(await signedUrl(path, 120, name ?? true));
    } catch {
      return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
    }
  }
  try {
    return NextResponse.redirect(await signedUrl(path, 120));
  } catch {
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
