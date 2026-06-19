import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", config.appUrl), { status: 303 });
}
