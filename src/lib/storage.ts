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

  // The bucket may not exist — create it (private) and retry once.
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
  const retry = await supabase.storage.from(bucket).upload(path, bytes, opts);
  if (retry.error) throw retry.error;
}

/** A short-lived signed URL for a stored object (for viewing/downloading). */
export async function signedUrl(path: string, expiresInSeconds = 120): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(config.storageBucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
  return data.signedUrl;
}
