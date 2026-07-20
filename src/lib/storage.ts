import { createServiceClient } from "@/lib/supabase/server";
import { config } from "@/lib/config";

/**
 * Upload bytes to the configured Supabase Storage bucket. If the bucket doesn't
 * exist yet, create it (private) and retry once — so the first upload doesn't
 * fail just because the bucket was never provisioned. Throws the underlying
 * Supabase error (with its message) when the upload still fails.
 */
export async function uploadToStorage(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const supabase = createServiceClient();
  const bucket = config.storageBucket;
  const opts = { contentType, upsert: false } as const;

  const first = await supabase.storage.from(bucket).upload(path, bytes, opts);
  if (!first.error) return;

  // The bucket may not exist — create it (private) and retry once. If creation
  // itself fails, surface that reason (usually a bad/missing service-role key).
  const created = await supabase.storage.createBucket(bucket, { public: false });
  if (created.error) {
    throw new Error(
      `${first.error.message} — could not auto-create bucket "${bucket}": ${created.error.message}`,
    );
  }
  const retry = await supabase.storage.from(bucket).upload(path, bytes, opts);
  if (retry.error) throw retry.error;
}

/** Download a stored object as base64 + its content type (for AI vision, etc.). */
export async function downloadFromStorage(path: string): Promise<{ base64: string; contentType: string }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(config.storageBucket).download(path);
  if (error || !data) throw error ?? new Error("Download failed");
  const buf = Buffer.from(await data.arrayBuffer());
  return { base64: buf.toString("base64"), contentType: data.type || "application/octet-stream" };
}

/**
 * A short-lived signed URL for a stored object. Pass `download` to force a
 * download (a filename string sets the saved name; `true` uses the stored one);
 * omit it to view the file inline in the browser.
 */
export async function signedUrl(
  path: string,
  expiresInSeconds = 120,
  download?: string | boolean,
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(config.storageBucket)
    .createSignedUrl(path, expiresInSeconds, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
  return data.signedUrl;
}
