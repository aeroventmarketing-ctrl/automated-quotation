import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/auth/signout", "/offline", "/q/", "/api/cron/", "/unsubscribe", "/api/marketing-track", "/api/marketing-image", "/rfq", "/api/rfq", "/api/public/", "/store", "/api/store-image", "/api/store/", "/robots.txt", "/sitemap.xml", "/llms.txt"];// /q/ = public shared quote links; /api/cron/ = scheduler (secret-checked in the route); /unsubscribe = marketing opt-out (HMAC-token-checked); /api/marketing-track = email open/click pixel; /api/marketing-image = campaign image proxy (HMAC-token-checked, marketing/ scope only) — must be public so recipients' mail clients (no login cookies) can load it; /rfq + /api/rfq = public RFQ intake form (honeypot + rate-limited; a valid ?c/&t prefill token is HMAC-checked); /api/public/ = read-only public data APIs (e.g. the store's Fan Selector — performance-only, no prices, CORS-open); /store = the public storefront (only items an admin has listed); /api/store-image = storefront product photos (scoped to photos of LISTED items — never an open bucket proxy); /api/store/ = storefront payment endpoints — the buyer has no session and the gateways call in server-to-server, so they must be public: /pay reads the amount from the ORDER row (never the request), the HitPay webhook is HMAC-verified against the API salt before anything is trusted, and the PayPal return captures against OUR stored providerRef; /robots.txt + /sitemap.xml + /llms.txt = crawler & AI-assistant discovery files — they MUST be reachable without a session or search engines see a login redirect instead of the shop. NOTE: /api/rfq-uploads/view is deliberately NOT public — attachments are staff-only; /api/store-uploads stays admin-only (upload + draft preview).

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

  /**
   * Verified LOCALLY, not at the Auth server.
   *
   * This runs on every request that is not a static file, and the route or page
   * behind it validates again — so `getUser()` here meant two round trips per
   * request, each costing five queries in the `auth` schema. Measured over 4.7
   * days: 421,580 validations, 2.1 million queries, 34% of every database call
   * the system made. The ratio against our own `User` lookup was 2.3 : 1, which
   * is those two calls.
   *
   * `getClaims()` checks the JWT's signature with WebCrypto against the cached
   * JWKS. If the project signs with a symmetric secret instead, it falls back to
   * the same server call as before — so this is never worse than what it
   * replaces, only cheaper when the project allows it.
   *
   * This is a REDIRECT GATE, not the security boundary. `(app)/layout.tsx` and
   * every API route resolve the user properly for themselves; a token that
   * passes here and has no matching `User` row gets signed out there.
   */
  const { data: verified } = await supabase.auth.getClaims();
  // `sub` is the user id, and a JWT without one is not a session whoever signed
  // it — so this is "is there a verified user", not "did a cookie parse".
  const user = verified?.claims?.sub ? verified.claims : null;

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
