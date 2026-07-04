/**
 * Per-user signature images for the quotation closing block.
 *
 * Signatures ride in the AppSetting key/value table (no schema migration — the
 * database can't be migrated from the build/deploy pipeline) under a single row
 * keyed "user_signatures" whose JSON value maps { [userId]: dataUrl }. Each
 * value is a small PNG/JPEG data URL (downscaled on upload). The Excel and PDF
 * generators embed the logged-in sales user's signature above their name.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const SIGNATURE_SETTING_KEY = "user_signatures";

/** Whole { userId: dataUrl } map (empty if unset). */
export async function getSignatureMap(): Promise<Record<string, string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: SIGNATURE_SETTING_KEY } });
  const v = (row?.value as Record<string, unknown> | null) ?? null;
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === "string" && val) out[k] = val;
  return out;
}

/** One user's signature data URL, or null. */
export async function getUserSignature(userId: string): Promise<string | null> {
  const map = await getSignatureMap();
  return map[userId] ?? null;
}

/** Save (or clear, when dataUrl is null) a user's signature. */
export async function setUserSignatureValue(userId: string, dataUrl: string | null): Promise<void> {
  const map = await getSignatureMap();
  if (dataUrl) map[userId] = dataUrl;
  else delete map[userId];
  await prisma.appSetting.upsert({
    where: { key: SIGNATURE_SETTING_KEY },
    create: { key: SIGNATURE_SETTING_KEY, value: map as Prisma.InputJsonValue },
    update: { value: map as Prisma.InputJsonValue },
  });
}

/**
 * Natural pixel size of a PNG or JPEG data URL, or null. Used to embed the
 * signature at the correct aspect ratio in the Excel export.
 */
export function imageDataUrlSize(dataUrl: string): { width: number; height: number } | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
  // PNG: IHDR width/height are big-endian at bytes 16–24.
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan segments for a Start-Of-Frame marker holding the dimensions.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof) {
        return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return null;
}
