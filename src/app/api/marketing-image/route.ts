import { NextRequest, NextResponse } from "next/server";
import { signedUrl } from "@/lib/storage";
import { verifyMarketingImageToken } from "@/lib/marketing-image-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public marketing-image proxy. Campaign emails embed
 * {appUrl}/api/marketing-image?p=<path>&t=<token> (see marketing-image-link.ts)
 * so images load from our sending domain instead of a raw supabase.co URL — a
 * Resend / Gmail deliverability best practice ("Host images on the sending
 * domain"). This verifies the HMAC token, then 302-redirects to a freshly-signed,
 * short-lived Supabase URL. No auth — it's the recipient's mail client fetching
 * it — but the token can't be forged and only the marketing/ scope is reachable.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("p") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!path.startsWith("marketing/") || !verifyMarketingImageToken(path, token)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    // Fresh signed URL, valid long enough for the mail proxy to follow the
    // redirect and fetch/cache the image. The token above is permanent, so the
    // image stays reachable via this route for emails opened weeks later.
    return NextResponse.redirect(await signedUrl(path, 60 * 60), 302);
  } catch (err) {
    console.error("marketing image proxy error", err);
    return new NextResponse("Could not open the image.", { status: 502 });
  }
}
