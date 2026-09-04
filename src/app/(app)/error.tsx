"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * What a page shows when it fails.
 *
 * Before this, a server-side error anywhere in the app produced Next's bare
 * white screen — *"Application error: a server-side exception has occurred…
 * Digest: 4118784689"* — with no heading, no navigation, and no way back except
 * the browser's Back button. The owner hit it on Check Monitoring and could only
 * report that something, somewhere, was broken.
 *
 * This does not fix any error. It makes one **survivable**: the rest of the app
 * is still reachable, the page can be retried without a reload, and the digest
 * is presented as the thing to quote rather than as an epitaph.
 *
 * Placed on the `(app)` group so it covers every signed-in screen. A page that
 * wants to explain its own failure better can still add its own `error.tsx`
 * beside itself; this is the floor, not the ceiling.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server logs the real stack; this puts the same identifier in the
    // browser console, so a screenshot of the console is enough to match the two.
    console.error("Page error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">This page couldn&apos;t be loaded</h1>
            <p className="text-sm text-muted-foreground">
              Something went wrong on the server while building this screen. Nothing you were looking at has been
              changed — try again, and if it keeps happening, send this reference:
            </p>
          </div>
          {/* The digest is what ties this screen to the entry in the server log. */}
          <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
            {error.digest ? `Digest: ${error.digest}` : error.message || "No further detail was reported."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => reset()}>
              <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Try again
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard">Back to the dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
