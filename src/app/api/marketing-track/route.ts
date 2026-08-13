import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { recordCampaignEvent } from "@/lib/marketing-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1×1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function pixelResponse(): NextResponse {
  return new NextResponse(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}

/**
 * Public marketing tracker. Guarded by nothing sensitive — it only records an
 * open/click for a (sendId, customerId) already in a send record; an unknown pair
 * is ignored. `e=open` returns a 1×1 pixel; `e=click` records then redirects to
 * the `u` target (validated http/https).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const sendId = p.get("s") ?? "";
  const customerId = p.get("c") ?? "";
  const event = p.get("e") === "click" ? "click" : "open";

  try { await recordCampaignEvent(sendId, customerId, event); } catch { /* best-effort */ }

  if (event === "click") {
    const target = p.get("u") ?? "";
    const safe = /^https?:\/\//i.test(target) ? target : config.appUrl;
    return NextResponse.redirect(safe);
  }
  return pixelResponse();
}
