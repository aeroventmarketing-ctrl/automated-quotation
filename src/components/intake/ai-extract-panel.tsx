"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Upload, AlertTriangle } from "lucide-react";
import { emptyParsed, type DraftItem, type DraftParsed } from "./types";

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function toDraft(items: Partial<DraftParsed>[]): DraftItem[] {
  return items.map((p) => {
    const parsed = { ...emptyParsed(), ...p };
    return {
      rawText:
        parsed.description ||
        [parsed.modelText, parsed.application].filter(Boolean).join(" — ") ||
        "Extracted item",
      qty: parsed.qty ?? 1,
      parsedJson: parsed,
    };
  });
}

export function AiExtractPanel({ onExtracted }: { onExtracted: (items: DraftItem[]) => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extractText() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      onExtracted(toDraft(data.items ?? []));
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  }

  async function extractImage(file: File) {
    if (!MEDIA_TYPES.includes(file.type)) {
      setError("Unsupported file type. Use JPEG, PNG, GIF, or WebP.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch("/api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      onExtracted(toDraft(data.items ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            AI transcribes the inquiry into editable line items. <strong>Always verify the
            extracted values</strong> — units and numbers may be misread. Nothing is final until
            an engineer/admin approves the quotation.
          </span>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Paste an email / RFQ text</label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Paste the customer's email or requirements here…"
          />
          <Button type="button" onClick={extractText} disabled={loading || !text.trim()}>
            <Sparkles className="h-4 w-4" />
            {loading ? "Extracting…" : "Extract items from text"}
          </Button>
        </div>

        <div className="space-y-2 border-t pt-4">
          <label className="text-sm font-medium">Upload a photo / spec sheet</label>
          <p className="text-xs text-muted-foreground">
            Nameplate, handwritten RFQ, or competitor quote → editable line items.
          </p>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" />
            <span>{loading ? "Reading image…" : "Choose image"}</span>
            <input
              type="file"
              accept={MEDIA_TYPES.join(",")}
              className="hidden"
              disabled={loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) extractImage(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
