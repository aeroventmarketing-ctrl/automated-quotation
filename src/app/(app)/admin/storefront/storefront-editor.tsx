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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** One line per entry — the simplest editor for a short, ordered list of strings. */
function LinesField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <Textarea
        rows={rows}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
      />
    </Field>
  );
}

/**
 * Admin → Storefront. Everything that decides the shop's vibe: colours, the
 * top bar, navigation, hero, the trust band, every section's copy, the FAQ and
 * the SEO / AI text. Saving revalidates the store, so changes are live on the
 * next page load.
 */
export function StorefrontEditor({ initial }: { initial: StoreTheme }) {
  const router = useRouter();
  const [t, setT] = useState<StoreTheme>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (p: Partial<StoreTheme>) => setT((s) => ({ ...s, ...p }));
  const setAt = <K extends "features" | "metrics" | "navLinks" | "faq">(
    key: K,
    i: number,
    p: Partial<StoreTheme[K][number]>,
  ) => setT((s) => ({ ...s, [key]: s[key].map((row, idx) => (idx === i ? { ...row, ...p } : row)) }));

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
          <div
            className="overflow-hidden rounded-lg border"
            style={{ background: `linear-gradient(115deg, ${t.ink} 0%, ${t.ink2} 58%, ${t.accentDark}33 100%)` }}
          >
            <div className="px-5 py-8">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/80">{t.heroEyebrow}</div>
              <div className="mt-2 text-xl font-extrabold uppercase leading-tight text-white sm:text-2xl">
                {t.heroHeadline}{" "}
                <span style={{ color: t.accent }}>{t.heroHeadlineAccent}</span>
              </div>
              <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/70">{t.heroSubhead}</p>
              <span
                className="mt-4 inline-block rounded px-4 py-2 text-xs font-bold text-white"
                style={{ background: t.accent }}
              >
                {t.heroCtaLabel} →
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
          <ColorField label="Dark ground" value={t.ink} onChange={(v) => set({ ink: v })} hint="Hero, footer, cart button" />
          <ColorField label="Dark ground (lighter)" value={t.ink2} onChange={(v) => set({ ink2: v })} hint="Category tiles" />
          <ColorField label="Page ground" value={t.paper} onChange={(v) => set({ paper: v })} hint="Behind the sections" />
          <Field label="Corners">
            <select
              value={t.radius}
              onChange={(e) => set({ radius: e.target.value as StoreTheme["radius"] })}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="sharp">Sharp — technical</option>
              <option value="soft">Soft — balanced</option>
              <option value="round">Rounded — friendly</option>
            </select>
          </Field>
          <Field label="Product images">
            <select
              value={t.imageFit}
              onChange={(e) => set({ imageFit: e.target.value as StoreTheme["imageFit"] })}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="cover">Fill the frame — photographed equipment</option>
              <option value="contain">Fit whole image — cut-out product shots</option>
            </select>
          </Field>
          <Field label="Logo" hint="A public path (/aerovent-logo.jpg), a store/… upload path, or a full URL.">
            <Input className="h-9 font-mono text-xs" value={t.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} />
          </Field>
          <Field label="Hero photo path (optional)" hint="Replaces the rotor artwork. Upload via a product photo, then paste its path.">
            <Input className="h-9 font-mono text-xs" value={t.heroImagePath} placeholder="store/…" onChange={(e) => set({ heroImagePath: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top bar &amp; navigation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Announcement — bold part (empty hides the bar)">
              <Input className="h-9" value={t.announcement} onChange={(e) => set({ announcement: e.target.value })} />
            </Field>
            <Field label="Announcement — the clause after it">
              <Input className="h-9" value={t.announcementNote} onChange={(e) => set({ announcementNote: e.target.value })} />
            </Field>
          </div>
          <LinesField
            label="Top-right notes (one per line, up to 3)"
            value={t.topLinks}
            onChange={(topLinks) => set({ topLinks })}
            rows={2}
          />
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Main navigation</span>
            {t.navLinks.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <Input className="h-9" value={l.label} placeholder="Label" onChange={(e) => setAt("navLinks", i, { label: e.target.value })} />
                <Input className="h-9 font-mono text-xs" value={l.href} placeholder="/store#products" onChange={(e) => setAt("navLinks", i, { href: e.target.value })} />
              </div>
            ))}
            <span className="block text-[11px] text-muted-foreground">
              Links starting with <code>http</code> open in a new tab. Clearing a label removes the entry on save.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Hero</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Eyebrow">
            <Input className="h-9" value={t.heroEyebrow} onChange={(e) => set({ heroEyebrow: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Headline — first line">
              <Input className="h-9" value={t.heroHeadline} onChange={(e) => set({ heroHeadline: e.target.value })} />
            </Field>
            <Field label="Headline — second line (accent colour)">
              <Input className="h-9" value={t.heroHeadlineAccent} onChange={(e) => set({ heroHeadlineAccent: e.target.value })} />
            </Field>
          </div>
          <Field label="Sub-headline">
            <Textarea rows={3} value={t.heroSubhead} onChange={(e) => set({ heroSubhead: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Button label">
              <Input className="h-9" value={t.heroCtaLabel} onChange={(e) => set({ heroCtaLabel: e.target.value })} />
            </Field>
            <Field label="Button link">
              <Input className="h-9" value={t.heroCtaHref} onChange={(e) => set({ heroCtaHref: e.target.value })} />
            </Field>
            <Field label="Second button (opens the quote form)">
              <Input className="h-9" value={t.heroCta2Label} onChange={(e) => set({ heroCta2Label: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Proof figures</span>
            {t.metrics.map((m, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                <Input className="h-9" value={m.value} placeholder="30+ Years" onChange={(e) => setAt("metrics", i, { value: e.target.value })} />
                <Input className="h-9" value={m.label} placeholder="Manufacturing experience" onChange={(e) => setAt("metrics", i, { label: e.target.value })} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Trust band (four panels)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {t.features.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_1fr]">
              <Field label="Icon">
                <select
                  value={f.icon}
                  onChange={(e) => setAt("features", i, { icon: e.target.value })}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <div className="space-y-2">
                <Input className="h-9" value={f.title} placeholder="Title" onChange={(e) => setAt("features", i, { title: e.target.value })} />
                <Input className="h-9" value={f.body} placeholder="One short line" onChange={(e) => setAt("features", i, { body: e.target.value })} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Section headings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {([
            ["Categories", "categoriesKicker", "categoriesTitle", "categoriesBlurb"],
            ["Catalogue", "catalogueKicker", "catalogueTitle", "catalogueBlurb"],
          ] as const).map(([name, kicker, title, blurb]) => (
            <div key={name} className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-semibold">{name}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input className="h-9" value={t[kicker]} placeholder="Kicker" onChange={(e) => set({ [kicker]: e.target.value } as Partial<StoreTheme>)} />
                <Input className="h-9" value={t[title]} placeholder="Heading" onChange={(e) => set({ [title]: e.target.value } as Partial<StoreTheme>)} />
              </div>
              <Textarea rows={2} value={t[blurb]} placeholder="Supporting line" onChange={(e) => set({ [blurb]: e.target.value } as Partial<StoreTheme>)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Made-to-order band</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kicker">
              <Input className="h-9" value={t.solutionKicker} onChange={(e) => set({ solutionKicker: e.target.value })} />
            </Field>
            <Field label="Heading">
              <Input className="h-9" value={t.solutionTitle} onChange={(e) => set({ solutionTitle: e.target.value })} />
            </Field>
          </div>
          <Field label="Body">
            <Textarea rows={3} value={t.solutionBody} onChange={(e) => set({ solutionBody: e.target.value })} />
          </Field>
          <LinesField
            label="Applications (one per line)"
            value={t.solutionBullets}
            onChange={(solutionBullets) => set({ solutionBullets })}
            rows={4}
          />
          <Field label="Button label" hint="Always opens the quotation dialog.">
            <Input className="h-9" value={t.solutionCtaLabel} onChange={(e) => set({ solutionCtaLabel: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Article &amp; FAQ</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kicker">
              <Input className="h-9" value={t.articleKicker} onChange={(e) => set({ articleKicker: e.target.value })} />
            </Field>
            <Field label="Heading">
              <Input className="h-9" value={t.articleTitle} onChange={(e) => set({ articleTitle: e.target.value })} />
            </Field>
          </div>
          <Field label="Body" hint="Separate paragraphs with a blank line. This is the shop's main indexable copy.">
            <Textarea rows={6} value={t.articleBody} onChange={(e) => set({ articleBody: e.target.value })} />
          </Field>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Frequently asked questions — also published as FAQ structured data
            </span>
            {t.faq.map((f, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <Input className="h-9" value={f.q} placeholder="Question" onChange={(e) => setAt("faq", i, { q: e.target.value })} />
                <Textarea rows={2} value={f.a} placeholder="Answer" onChange={(e) => setAt("faq", i, { a: e.target.value })} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Contact &amp; links</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone"><Input className="h-9" value={t.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Sales email"><Input className="h-9" value={t.salesEmail} onChange={(e) => set({ salesEmail: e.target.value })} /></Field>
          <Field label="Main website"><Input className="h-9" value={t.mainSiteUrl} onChange={(e) => set({ mainSiteUrl: e.target.value })} /></Field>
          <Field label="Facebook page"><Input className="h-9" value={t.facebookUrl} onChange={(e) => set({ facebookUrl: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">SEO &amp; AI discoverability</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Page title" hint={`${t.seoTitle.length} characters — aim for 50–60.`}>
            <Input className="h-9" value={t.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
          </Field>
          <Field label="Meta description" hint={`${t.seoDescription.length} characters — aim for 140–160.`}>
            <Textarea rows={3} value={t.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
          </Field>
          <Field label="Focus keywords (comma separated)">
            <Textarea rows={2} value={t.seoKeywords} onChange={(e) => set({ seoKeywords: e.target.value })} />
          </Field>
          <Field label="Summary for AI assistants">
            <Textarea rows={3} value={t.aiSummary} onChange={(e) => set({ aiSummary: e.target.value })} />
          </Field>
          <span className="block text-[11px] text-muted-foreground">
            The summary is used in <code>/llms.txt</code>, the site&rsquo;s structured data and the footer — how ChatGPT,
            Gemini and friends describe you. Say plainly what you make, where, and for whom.
          </span>
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
