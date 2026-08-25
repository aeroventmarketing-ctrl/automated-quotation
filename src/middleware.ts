import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/auth/signout", "/offline", "/q/", "/api/cron/", "/unsubscribe", "/api/marketing-track", "/api/marketing-image", "/rfq", "/api/rfq", "/api/public/", "/store", "/api/store-image"]; // /q/ = public shared quote links; /api/cron/ = scheduler (secret-checked in the route); /unsubscribe = marketing opt-out (HMAC-token-checked); /api/marketing-track = email open/click pixel; /api/marketing-image = campaign image proxy (HMAC-token-checked, marketing/ scope only) — must be public so recipients' mail clients (no login cookies) can load it; /rfq + /api/rfq = public RFQ intake form (honeypot + rate-limited; a valid ?c/&t prefill token is HMAC-checked); /api/public/ = read-only public data APIs (e.g. the store's Fan Selector — performance-only, no prices, CORS-open); /store = the public storefront (only items an admin has listed); /api/store-image = storefront product photos (scoped to photos of LISTED items — never an open bucket proxy). NOTE: /api/rfq-uploads/view is deliberately NOT public — attachments are staff-only; /api/store-uploads stays admin-only (upload + draft preview).

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // If Supabase isn't configured yet, don't block (lets the app boot for setup).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Match a public path exactly, as a slash-terminated prefix (entries ending in
  // "/"), or on a path-segment boundary — so "/api/rfq" does NOT also whitelist
  // the staff-only "/api/rfq-uploads/view".
  const isPublic = PUBLIC_PATHS.some((p) => path === p || (p.endsWith("/") && path.startsWith(p)) || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except static assets, the SW, and the manifest.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|aerovent-logo.jpg|login-bg.jpg|straight-duct.png|duct-connector.jpg|reducer.jpg|square-to-round.jpg|elbow.jpg|offset-duct.jpg|y-duct.jpg|r-duct.jpg|manifest.webmanifest|sw.js).*)"],
};
