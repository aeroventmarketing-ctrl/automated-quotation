import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

// Clear the Supabase session and return to the login page. Handles GET as well
// as POST so the app layout can redirect orphaned sessions here (a Supabase
// session with no matching app User row) to break the redirect loop. The
// redirect base is the request URL so it always uses the real host (not
// config.appUrl, which may still be localhost in some environments).
async function signOut(req: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}

export const GET = signOut;
export const POST = signOut;
