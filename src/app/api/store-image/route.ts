import { NextRequest, NextResponse } from "next/server";
import { signedUrl } from "@/lib/storage";
import { isPublicStorePhoto } from "@/lib/store-catalog";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Public product image for the storefront. Unlike the admin `/api/store-uploads`
 * preview, this needs no login — shoppers aren't signed in.
 *
 * It is NOT an open proxy to the storage bucket: the path must be under `store/`
 * AND must actually be one of the photos of a **listed** catalogue item, so an
 * unlisted draft's images and every other object stay unreachable.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  if (!(await isPublicStorePhoto(path))) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  }
  try {
    // The signed URL lives 1 hour; let browsers and the CDN reuse this redirect
    // for a fraction of that. Without it every <img> on every page view costs a
    // round trip AND a database read, which is the storefront's slowest path.
    const url = await signedUrl(path, 3600);
    return NextResponse.redirect(url, {
      headers: { "Cache-Control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("store image error", err);
    return NextResponse.json({ error: "Could not open the image." }, { status: 502 });
  }
}
