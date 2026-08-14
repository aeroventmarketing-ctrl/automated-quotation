import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * View / download a client-submitted RFQ attachment. Staff-only (any logged-in
 * user) — the files live in the private bucket and are only referenced from the
 * Inbound RFQ review queue. Only paths under "rfq-uploads/" are served. Add
 * ?download=1 to force a download instead of an inline view.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const path = req.nextUrl.searchParams.get("path");
  if (!path || !path.startsWith("rfq-uploads/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const name = req.nextUrl.searchParams.get("name") || path.split("/").pop() || "attachment";
  const download = req.nextUrl.searchParams.get("download") !== null;

  try {
    return NextResponse.redirect(await signedUrl(path, 120, download ? name : undefined));
  } catch {
    return NextResponse.json({ error: "Could not open the file." }, { status: 502 });
  }
}
