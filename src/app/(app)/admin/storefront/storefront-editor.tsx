"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_STORE_THEME, type StoreTheme } from "@/lib/store-theme";
import { saveStoreTheme } from "./actions";

const ICON_KEYS = ["factory", "truck", "wrench", "shield", "support", "check"] as const;

/** Colour field — a swatch picker beside the hex, so either can be used. */
function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border bg-background p-1"
          aria-label={`${label} colour picker`}
        />
        <Input className="h-9 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Admin → Storefront. Everything that decides the shop's vibe: colours,
 * rounding, hero copy, the three value props, and the SEO / AI text. Saving
 * revalidates the store, so changes are live on the next page load.
 */
export function StorefrontEditor({ initial }: { initial: StoreTheme }) {
  const router = useRouter();
  const [t, setT] = useState<StoreTheme>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (p: Partial<StoreTheme>) => setT((s) => ({ ...s, ...p }));
  const setFeature = (i: number, p: Partial<StoreTheme["features"][number]>) =>
    setT((s) => ({ ...s, features: s.features.map((f, idx) => (idx === i ? { ...f, ...p } : f)) }));

  async function save() {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const saved = await saveStoreTheme(t);
      setT(saved);
      setMsg("Saved — the storefront updates on its next load.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Live preview of the palette — cheap, but it makes the colour choice real. */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Preview</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border" style={{ background: t.ink }}>
            <div className="px-5 py-8">
              <div className="text-lg font-extrabold leading-tight text-white sm:text-xl">{t.heroHeadline}</div>
              <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/70">{t.heroSubhead}</p>
              <span
                className="mt-4 inline-block rounded-full px-4 py-2 text-xs font-bold text-white"
                style={{ background: t.accent }}
              >
                {t.heroCtaLabel}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Look</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <ColorField label="Accent" value={t.accent} onChange={(v) => set({ accent: v })} hint="Buttons, links, highlights" />
          <ColorField label="Accent (hover)" value={t.accentDark} onChange={(v) => set({ accentDark: v })} hint="A shade darker" />
          <ColorField label="Dark ground" value={t.ink} onChange={(v) => set({ ink: v })} hint="Hero & announcement bar" />
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Corners</span>
            <select
              value={t.radius}
              onChange={(e) => set({ radius: e.target.value as StoreTheme["radius"] })}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="sharp">Sharp — technical</option>
              <option value="soft">Soft — balanced</option>
              <option value="round">Rounded — friendly</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Product images</span>
            <select
              value={t.imageFit}
              onChange={(e) => set({ imageFit: e.target.value as StoreTheme["imageFit"] })}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="contain">Fit whole image — cut-out product shots</option>
              <option value="cover">Fill the frame — lifestyle photos</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Hero image path (optional)</span>
            <Input className="h-9 font-mono text-xs" value={t.heroImagePath} placeholder="store/…" onChange={(e) => set({ heroImagePath: e.target.value })} />
            <span className="text-[11px] text-muted-foreground">Upload via a product photo, then paste its path.</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Hero &amp; announcement</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Announcement bar (empty hides it)</span>
            <Input className="h-9" value={t.announcement} onChange={(e) => set({ announcement: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Headline</span>
            <Textarea rows={2} value={t.heroHeadline} onChange={(e) => set({ heroHeadline: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sub-headline</span>
            <Textarea rows={2} value={t.heroSubhead} onChange={(e) => set({ heroSubhead: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Button label</span>
              <Input className="h-9" value={t.heroCtaLabel} onChange={(e) => set({ heroCtaLabel: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Button link</span>
              <Input className="h-9" value={t.heroCtaHref} onChange={(e) => set({ heroCtaHref: e.target.value })} />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Why buy from us (three panels)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {t.features.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_1fr]">
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Icon</span>
                <select
                  value={f.icon}
                  onChange={(e) => setFeature(i, { icon: e.target.value })}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <div className="space-y-2">
                <Input className="h-9" value={f.title} placeholder="Title" onChange={(e) => setFeature(i, { title: e.target.value })} />
                <Textarea rows={2} value={f.body} placeholder="One or two sentences" onChange={(e) => setFeature(i, { body: e.target.value })} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">SEO &amp; AI discoverability</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Page title</span>
            <Input className="h-9" value={t.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
            <span className="text-[11px] text-muted-foreground">{t.seoTitle.length} characters — aim for 50–60.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Meta description</span>
            <Textarea rows={3} value={t.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
            <span className="text-[11px] text-muted-foreground">{t.seoDescription.length} characters — aim for 140–160.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Focus keywords (comma separated)</span>
            <Textarea rows={2} value={t.seoKeywords} onChange={(e) => set({ seoKeywords: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Summary for AI assistants</span>
            <Textarea rows={3} value={t.aiSummary} onChange={(e) => set({ aiSummary: e.target.value })} />
            <span className="text-[11px] text-muted-foreground">
              Used in <code>/llms.txt</code>, the site&rsquo;s structured data and the footer — how ChatGPT, Gemini and
              friends describe you. Say plainly what you make, where, and for whom.
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save storefront"}</Button>
        <Button size="sm" variant="outline" onClick={() => setT(DEFAULT_STORE_THEME)} disabled={busy}>
          Reset to defaults
        </Button>
        <a href="/store" target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
          View store ↗
        </a>
        {msg && <span className="text-xs text-emerald-600">{msg}</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}
