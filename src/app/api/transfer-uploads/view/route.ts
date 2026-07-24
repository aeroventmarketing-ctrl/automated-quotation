import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * View a stock-transfer proof inline (PDF / images render natively in the
 * browser via a signed URL). Add ?download=1 to force a download.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("transfers/")) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  const name = req.nextUrl.searchParams.get("name") || path.split("/").pop() || "document";
  if (req.nextUrl.searchParams.get("download") !== null) {
    try {
      return NextResponse.redirect(await signedUrl(path, 120, name));
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
