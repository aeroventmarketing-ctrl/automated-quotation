import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { runImport } from "@/lib/import/csv";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  type: z.enum(["catalogue", "pricelist", "ratings"]),
  csv: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await runImport(body.type, body.csv);
    return NextResponse.json(result);
  } catch (err) {
    console.error("import error", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
