import { NextRequest, NextResponse } from "next/server";
import { downloadBytes } from "@/lib/storage";
import { verifyMarketingImageToken } from "@/lib/marketing-image-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Public marketing-image proxy. Campaign emails embed
 * {appUrl}/api/marketing-image/<token>/<storage-path> (see marketing-image-link.ts)
 * so images load from our sending domain instead of a raw supabase.co URL — a
 * Resend / Gmail deliverability best practice ("Host images on the sending
 * domain").
 *
 * It **streams the image bytes back directly** (a 200 response) rather than
 * redirecting to a signed Supabase URL: an embedded `<img>` (in a mail client's
 * image proxy, or a sandboxed preview iframe) doesn't reliably follow a
 * cross-origin 302, so a redirect leaves the image broken even though the URL
 * works on direct navigation. A same-origin 200 with the image body always loads.
 *
 * The token + path live in the URL path (not the query string) so HTML-escaping
 * of "&" can't split the token off. Verifies the HMAC token (marketing/ scope
 * only, unforgeable). No auth — it's the recipient's mail client fetching it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; path: string[] }> },
) {
  const { token, path: segments } = await params;
  const path = (segments ?? []).join("/");
  if (!path.startsWith("marketing/") || !verifyMarketingImageToken(path, token)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const { bytes, contentType } = await downloadBytes(path);
    const body = new Uint8Array(bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
        "Content-Length": String(body.byteLength),
        // Uniquely-named objects never change, so let clients / mail proxies cache hard.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch (err) {
    console.error("marketing image proxy error", err);
    return new NextResponse("Not found", { status: 404 });
  }
}
