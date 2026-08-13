"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Upload, Trash2, Plus, Image as ImageIcon, Save, Copy, FolderOpen, Clock } from "lucide-react";
import type { CampaignDraft, CampaignProduct, CampaignImage } from "@/lib/marketing-campaign";
import type { MarketingRunResult, CampaignPreview } from "@/lib/marketing-runner";
import type { SavedCampaign, ScheduledCampaign } from "@/lib/marketing-store";

// Personalization tokens (kept in sync with CAMPAIGN_TOKENS on the server). Held
// locally so this client component never imports the server-only campaign lib.
const TOKENS = [
  { label: "First name", token: "{firstName}" },
  { label: "Contact name", token: "{contactName}" },
  { label: "Company name", token: "{company}" },
];

type Audience = "list" | "all";

const thumbUrl = (path: string) => `/api/marketing-uploads?path=${encodeURIComponent(path)}`;

export function CampaignBuilder({
  draft,
  templates: initialTemplates,
  listCount,
  allCount,
  emailReady,
  onSaveDraft,
  onPreview,
  onPreviewRecipients,
  onSend,
  onTest,
  onSaveTemplate,
  onDeleteTemplate,
  onDuplicateTemplate,
  onSchedule,
  onStartAb,
}: {
  draft: CampaignDraft;
  templates: SavedCampaign[];
  listCount: number;
  allCount: number;
  emailReady: boolean;
  onSaveDraft: (d: CampaignDraft) => Promise<CampaignDraft>;
  onPreview: (d: CampaignDraft) => Promise<CampaignPreview>;
  onPreviewRecipients: (input: { draft: CampaignDraft; audience: Audience }) => Promise<MarketingRunResult>;
  onSend: (input: { draft: CampaignDraft; audience: Audience }) => Promise<MarketingRunResult>;
  onTest: (input: { draft: CampaignDraft; toEmail: string }) => Promise<{ ok: boolean; reason?: string }>;
  onSaveTemplate: (input: { id?: string; name: string; draft: CampaignDraft }) => Promise<SavedCampaign[]>;
  onDeleteTemplate: (id: string) => Promise<SavedCampaign[]>;
  onDuplicateTemplate: (id: string) => Promise<SavedCampaign[]>;
  onSchedule: (input: { name: string; draft: CampaignDraft; audience: Audience; scheduledFor: string }) => Promise<ScheduledCampaign[]>;
  onStartAb: (input: { name?: string; draft: CampaignDraft; subjectB: string; audience: Audience; testFraction: number; decideAfterHours: number }) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const router = useRouter();
  const [d, setD] = useState<CampaignDraft>(draft);
  // Benefits edited as free text (one per line) so blank lines survive typing.
  const [benefitsText, setBenefitsText] = useState((draft.benefits ?? []).join("\n"));

  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  // Assemble the current draft for save / preview / send.
  const current = useMemo<CampaignDraft>(
    () => ({ ...d, benefits: benefitsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) }),
    [d, benefitsText],
  );
  const currentKey = useMemo(() => JSON.stringify(current), [current]);

  // ---- Live preview (debounced server render) ----
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(async () => {
      setPreviewing(true); setPreviewErr(null);
      try {
        const p = await onPreview(current);
        if (!cancelled) setPreview(p);
      } catch (e) {
        if (!cancelled) setPreviewErr(e instanceof Error ? e.message : "Preview failed");
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(h); };
  }, [currentKey, onPreview, current]);

  // ---- Save ----
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setSaveMsg(null);
    try { await onSaveDraft(current); setSaveMsg({ ok: true, text: "Draft saved." }); }
    catch (e) { setSaveMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" }); }
    finally { setSaving(false); }
  }

  // ---- Saved templates ----
  const [templates, setTemplates] = useState<SavedCampaign[]>(initialTemplates);
  const [loadedId, setLoadedId] = useState<string>("");
  const [tplBusy, setTplBusy] = useState<string | null>(null);
  const [tplMsg, setTplMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loaded = templates.find((t) => t.id === loadedId) ?? null;

  function loadDraft(next: CampaignDraft) {
    setD(next);
    setBenefitsText((next.benefits ?? []).join("\n"));
  }
  function loadTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setLoadedId(id);
    loadDraft(t.draft);
    setTplMsg({ ok: true, text: `Loaded “${t.name}”.` });
  }
  async function saveTemplate(asNew: boolean) {
    const suggested = asNew ? "" : loaded?.name ?? "";
    const name = window.prompt(asNew ? "Save as a new campaign — name:" : "Update campaign name:", suggested);
    if (name === null) return;
    if (!name.trim()) { setTplMsg({ ok: false, text: "Name the campaign." }); return; }
    setTplBusy("save"); setTplMsg(null);
    try {
      const list = await onSaveTemplate({ id: asNew ? undefined : loaded?.id, name: name.trim(), draft: current });
      setTemplates(list);
      const match = list.find((t) => t.name === name.trim());
      if (match) setLoadedId(match.id);
      setTplMsg({ ok: true, text: asNew ? "Saved to the library." : "Template updated." });
    } catch (e) { setTplMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" }); }
    finally { setTplBusy(null); }
  }
  async function duplicateTemplate() {
    if (!loaded) return;
    setTplBusy("dup"); setTplMsg(null);
    try { setTemplates(await onDuplicateTemplate(loaded.id)); setTplMsg({ ok: true, text: "Duplicated." }); }
    catch (e) { setTplMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setTplBusy(null); }
  }
  async function deleteTemplate() {
    if (!loaded) return;
    if (!window.confirm(`Delete the saved campaign “${loaded.name}”?`)) return;
    setTplBusy("del"); setTplMsg(null);
    try { setTemplates(await onDeleteTemplate(loaded.id)); setLoadedId(""); setTplMsg({ ok: true, text: "Deleted." }); }
    catch (e) { setTplMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setTplBusy(null); }
  }

  // ---- Images / products upload ----
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  async function upload(file: File): Promise<{ path: string; name: string } | null> {
    setUploadErr(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/marketing-uploads", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { setUploadErr(data.error || "Upload failed"); return null; }
    return { path: data.path, name: data.name };
  }
  async function addImage(file: File) {
    setUploading("image");
    const up = await upload(file);
    if (up) set("images", [...d.images, { path: up.path, name: up.name } as CampaignImage]);
    setUploading(null);
  }
  function updateImage(i: number, patch: Partial<CampaignImage>) {
    set("images", d.images.map((im, idx) => (idx === i ? { ...im, ...patch } : im)));
  }
  function removeImage(i: number) { set("images", d.images.filter((_, idx) => idx !== i)); }

  function updateProduct(i: number, patch: Partial<CampaignProduct>) {
    set("products", d.products.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addProduct() { set("products", [...d.products, { name: "", blurb: "" }]); }
  function removeProduct(i: number) { set("products", d.products.filter((_, idx) => idx !== i)); }
  async function setProductImage(i: number, file: File) {
    setUploading(`product-${i}`);
    const up = await upload(file);
    if (up) updateProduct(i, { imagePath: up.path, imageName: up.name });
    setUploading(null);
  }

  // ---- Audience / send / test ----
  const [audience, setAudience] = useState<Audience>("list");
  const audienceCount = audience === "list" ? listCount : allCount;
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingRunResult | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function previewRecipients() {
    setBusy("preview-recips"); setSendErr(null); setResult(null);
    try { setResult(await onPreviewRecipients({ draft: current, audience })); }
    catch (e) { setSendErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }
  async function send() {
    if (!window.confirm(`Send this campaign to ${audienceCount} client${audienceCount === 1 ? "" : "s"} now? This cannot be undone.`)) return;
    setBusy("send"); setSendErr(null); setResult(null);
    try {
      await onSaveDraft(current); // persist what was sent
      setResult(await onSend({ draft: current, audience }));
    } catch (e) { setSendErr(e instanceof Error ? e.message : "Send failed"); }
    finally { setBusy(null); }
  }
  async function test() {
    setBusy("test"); setTestMsg(null);
    try {
      const r = await onTest({ draft: current, toEmail: testEmail });
      setTestMsg(r.ok ? { ok: true, text: `Test sent to ${testEmail}.` } : { ok: false, text: r.reason || "Could not send test." });
    } catch (e) { setTestMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(null); }
  }

  // ---- Schedule for later ----
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleMsg, setScheduleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function schedule() {
    if (!scheduleAt) { setScheduleMsg({ ok: false, text: "Pick a date and time." }); return; }
    const iso = new Date(scheduleAt).toISOString();
    if (new Date(iso).getTime() <= Date.now()) { setScheduleMsg({ ok: false, text: "Pick a time in the future." }); return; }
    setBusy("schedule"); setScheduleMsg(null);
    try {
      await onSaveDraft(current);
      await onSchedule({ name: loaded?.name ?? current.subject, draft: current, audience, scheduledFor: iso });
      setScheduleMsg({ ok: true, text: `Scheduled for ${new Date(iso).toLocaleString()} to ${audienceCount} client${audienceCount === 1 ? "" : "s"}.` });
      setScheduleAt("");
      router.refresh(); // surface it in the activity panel below
    } catch (e) { setScheduleMsg({ ok: false, text: e instanceof Error ? e.message : "Failed to schedule" }); }
    finally { setBusy(null); }
  }

  // ---- A/B subject test ----
  const [abOn, setAbOn] = useState(false);
  const [subjectB, setSubjectB] = useState("");
  const [testPct, setTestPct] = useState("30");
  const [decideHours, setDecideHours] = useState("4");
  const [abMsg, setAbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function startAb() {
    const b = subjectB.trim();
    if (!b) { setAbMsg({ ok: false, text: "Enter subject B." }); return; }
    const frac = Math.min(90, Math.max(10, parseInt(testPct, 10) || 30)) / 100;
    const hours = Math.min(72, Math.max(1, parseInt(decideHours, 10) || 4));
    const testCount = Math.round(audienceCount * frac);
    if (!window.confirm(`Start A/B test: send subjects A & B to ~${testCount} of ${audienceCount} client${audienceCount === 1 ? "" : "s"} now, then send the winner to the rest in ${hours}h?`)) return;
    setBusy("ab"); setAbMsg(null);
    try {
      await onSaveDraft(current);
      const r = await onStartAb({ name: loaded?.name ?? current.subject, draft: current, subjectB: b, audience, testFraction: frac, decideAfterHours: hours });
      if (r.ok) { setAbMsg({ ok: true, text: "A/B test started — the winner sends automatically." }); router.refresh(); }
      else setAbMsg({ ok: false, text: r.reason || "Could not start the test." });
    } catch (e) { setAbMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(null); }
  }

  const field = "space-y-1";
  const hint = "text-[11px] text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Campaign builder</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 lg:grid-cols-2">
          {/* ---------- Editor ---------- */}
          <div className="space-y-4">
            {/* Saved templates library */}
            <div className="space-y-1 rounded-md border bg-muted/20 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <Select value={loadedId} onChange={(e) => (e.target.value ? loadTemplate(e.target.value) : setLoadedId(""))} className="h-8 min-w-[12rem] flex-1 text-xs">
                  <option value="">Saved campaigns…{templates.length ? "" : " (none yet)"}</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => saveTemplate(true)} disabled={tplBusy != null}>
                  <Save className="mr-1 h-3.5 w-3.5" /> Save as new
                </Button>
                {loaded && (
                  <>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => saveTemplate(false)} disabled={tplBusy != null}>Update</Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={duplicateTemplate} disabled={tplBusy != null}><Copy className="mr-1 h-3.5 w-3.5" />Duplicate</Button>
                    <button type="button" onClick={deleteTemplate} disabled={tplBusy != null} className="text-muted-foreground hover:text-destructive" aria-label="Delete campaign"><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </div>
              {tplMsg && <p className={`text-xs ${tplMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{tplMsg.text}</p>}
            </div>

            <p className={hint}>
              Every section is optional — leave one blank and it&rsquo;s dropped from the email. Use tokens{" "}
              {TOKENS.map((t) => <code key={t.token} className="mx-0.5 rounded bg-muted px-1">{t.token}</code>)} to personalize per client.
            </p>

            <div className={field}>
              <Label className="text-xs">Sender name</Label>
              <Input value={d.senderName} onChange={(e) => set("senderName", e.target.value)} placeholder="Aerovent Fans and Blowers Manufacturing" />
              <p className={hint}>Shown as the From name. The sending address is your configured marketing address.</p>
            </div>

            <div className={field}>
              <Label className="text-xs">Subject line</Label>
              <Input value={d.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Is Excessive Heat Affecting Your Production Area?" />
            </div>

            <div className={field}>
              <Label className="text-xs">Preheader (preview text)</Label>
              <Input value={d.preheader} onChange={(e) => set("preheader", e.target.value)} placeholder="Discover an airflow solution designed around your facility's requirements." />
            </div>

            <div className={field}>
              <Label className="text-xs">Greeting</Label>
              <Input value={d.greeting} onChange={(e) => set("greeting", e.target.value)} placeholder="Dear {firstName}," />
            </div>

            <div className={field}>
              <Label className="text-xs">Opening hook</Label>
              <Textarea rows={2} value={d.hook} onChange={(e) => set("hook", e.target.value)} placeholder="Poor airflow and excessive heat can affect employee comfort, equipment performance, and overall productivity." />
              <p className={hint}>Lead with the customer&rsquo;s problem or opportunity.</p>
            </div>

            <div className={field}>
              <Label className="text-xs">Main value proposition</Label>
              <Textarea rows={3} value={d.valueProp} onChange={(e) => set("valueProp", e.target.value)} placeholder="How you help: customized ventilation solutions, industrial fans & blowers, airflow engineering, installation, technical support…" />
            </div>

            {/* Products */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Featured products / services</Label>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addProduct}><Plus className="mr-1 h-3 w-3" />Add</Button>
              </div>
              <p className={hint}>Feature only what fits this campaign — don&rsquo;t list the whole catalogue.</p>
              {d.products.map((p, i) => (
                <div key={i} className="space-y-2 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Input className="h-8" value={p.name} onChange={(e) => updateProduct(i, { name: e.target.value })} placeholder="Product / service name" />
                    <button type="button" onClick={() => removeProduct(i)} className="text-muted-foreground hover:text-destructive" aria-label="Remove product"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <Textarea rows={2} value={p.blurb} onChange={(e) => updateProduct(i, { blurb: e.target.value })} placeholder="One line on how it helps (benefit, not just specs)." />
                  <div className="flex items-center gap-2">
                    {p.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbUrl(p.imagePath)} alt={p.imageName || "product"} className="h-10 w-10 rounded object-cover" />
                    ) : null}
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent">
                      <ImageIcon className="h-3.5 w-3.5" /> {uploading === `product-${i}` ? "Uploading…" : p.imagePath ? "Replace image" : "Add image"}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && setProductImage(i, e.target.files[0])} />
                    </label>
                    {p.imagePath && <button type="button" onClick={() => updateProduct(i, { imagePath: undefined, imageName: undefined })} className="text-xs text-muted-foreground hover:text-destructive">Remove image</button>}
                  </div>
                </div>
              ))}
            </div>

            {/* Benefits */}
            <div className={field}>
              <Label className="text-xs">Benefits (one per line)</Label>
              <Textarea rows={4} value={benefitsText} onChange={(e) => setBenefitsText(e.target.value)} placeholder={"Better airflow throughout your facility\nReduced heat buildup on the production floor\nImproved working conditions for your staff"} />
              <p className={hint}>Connect specs to outcomes — what the customer gains, not just CFM / HP / RPM.</p>
            </div>

            {/* Images */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Visuals (photos / installations)</Label>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent">
                  <Upload className="h-3.5 w-3.5" /> {uploading === "image" ? "Uploading…" : "Upload image"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addImage(e.target.files[0])} />
                </label>
              </div>
              <p className={hint}>The first image is the hero banner; the rest appear as a gallery.</p>
              {d.images.map((im, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(im.path)} alt={im.name} className="h-12 w-16 rounded object-cover" />
                  <div className="flex-1">
                    <div className="truncate text-xs text-muted-foreground">{i === 0 ? "Hero — " : ""}{im.name}</div>
                    <Input className="mt-1 h-7 text-xs" value={im.caption ?? ""} onChange={(e) => updateImage(i, { caption: e.target.value })} placeholder="Caption (optional)" />
                  </div>
                  <button type="button" onClick={() => removeImage(i)} className="text-muted-foreground hover:text-destructive" aria-label="Remove image"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {uploadErr && <p className="text-xs text-destructive">{uploadErr}</p>}
            </div>

            <div className={field}>
              <Label className="text-xs">Social proof / credibility</Label>
              <Textarea rows={2} value={d.socialProof} onChange={(e) => set("socialProof", e.target.value)} placeholder="Completed projects, industries served, testimonials, years of experience, testing procedures…" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className={field}>
                <Label className="text-xs">CTA button label</Label>
                <Input value={d.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} placeholder="Request a Quotation" />
              </div>
              <div className={field}>
                <Label className="text-xs">CTA link</Label>
                <Input value={d.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://www.aeroventfbm.com" />
              </div>
            </div>

            <div className={field}>
              <Label className="text-xs">Contact information</Label>
              <Textarea rows={3} value={d.contactInfo} onChange={(e) => set("contactInfo", e.target.value)} />
            </div>

            <div className={field}>
              <Label className="text-xs">Footer</Label>
              <Textarea rows={3} value={d.footer} onChange={(e) => set("footer", e.target.value)} />
            </div>

            <div className={field}>
              <Label className="text-xs">Unsubscribe line</Label>
              <Textarea rows={2} value={d.unsubscribeText} onChange={(e) => set("unsubscribeText", e.target.value)} />
              <p className={hint}>A one-click <strong>Unsubscribe</strong> link is appended automatically for each recipient.</p>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save draft"}</Button>
              {saveMsg && <span className={`text-xs ${saveMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{saveMsg.text}</span>}
            </div>
          </div>

          {/* ---------- Preview + send ---------- */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Live preview {previewing && <span className="text-muted-foreground">· updating…</span>}</Label>
              {preview && <span className="text-[11px] text-muted-foreground">personalized for {preview.sampleTo}</span>}
            </div>
            <div className="overflow-hidden rounded-md border bg-white">
              {preview ? (
                <>
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">Subject: </span><span className="font-medium">{preview.subject}</span>
                  </div>
                  <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[560px] w-full" />
                </>
              ) : (
                <div className="p-6 text-center text-xs text-muted-foreground">{previewErr ?? "Building preview…"}</div>
              )}
            </div>

            {!emailReady && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Email delivery isn&rsquo;t configured — set <code>RESEND_API_KEY</code> and <code>FOLLOW_UP_FROM_EMAIL</code>. Until then you can build &amp; preview, but sending is disabled.
              </div>
            )}

            {/* Test send */}
            <div className="space-y-1 rounded-md border p-2">
              <Label className="text-xs">Send a test to yourself</Label>
              <div className="flex items-center gap-2">
                <Input className="h-8" type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={test} disabled={busy === "test" || !emailReady || !testEmail.trim()}>{busy === "test" ? "Sending…" : "Send test"}</Button>
              </div>
              {testMsg && <p className={`text-xs ${testMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{testMsg.text}</p>}
            </div>

            {/* Audience + send */}
            <div className="space-y-2 rounded-md border p-2">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Audience</Label>
                  <Select value={audience} onChange={(e) => { setAudience(e.target.value as Audience); setResult(null); }} className="h-9 w-60">
                    <option value="list">Marketing list ({listCount})</option>
                    <option value="all">All clients with email ({allCount})</option>
                  </Select>
                </div>
                <span className="pb-2 text-xs text-muted-foreground">{audienceCount} recipient{audienceCount === 1 ? "" : "s"} · opt-outs skipped</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={previewRecipients} disabled={busy != null}>{busy === "preview-recips" ? "Counting…" : "Preview recipients"}</Button>
                <Button size="sm" onClick={send} disabled={busy != null || !emailReady}>{busy === "send" ? "Sending…" : `Send now${audienceCount ? ` (${audienceCount})` : ""}`}</Button>
                {sendErr && <span className="text-xs text-destructive">{sendErr}</span>}
              </div>
              {/* Schedule for later */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="h-8 w-56 text-xs" />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={schedule} disabled={busy != null || !emailReady || !scheduleAt}>{busy === "schedule" ? "Scheduling…" : "Schedule send"}</Button>
              </div>
              {scheduleMsg && <p className={`text-xs ${scheduleMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{scheduleMsg.text}</p>}
              {result && (
                <div className="rounded-md border bg-muted/30 p-2 text-xs">
                  {result.live ? (
                    <p className="font-medium text-emerald-700">Sent to {result.sent} client{result.sent === 1 ? "" : "s"}{result.skipped ? ` · ${result.skipped} skipped` : ""}{result.errors.length ? ` · ${result.errors.length} failed` : ""}.</p>
                  ) : (
                    <p className="font-medium text-foreground">{result.previewed} client{result.previewed === 1 ? "" : "s"} would receive this{result.reason ? ` · not sent: ${result.reason}` : ""}.</p>
                  )}
                  {result.errors.length > 0 && <ul className="mt-1 list-inside list-disc text-destructive">{result.errors.slice(0, 8).map((er, i) => <li key={i}>{er}</li>)}</ul>}
                </div>
              )}
            </div>

            {/* A/B subject test */}
            <div className="space-y-2 rounded-md border p-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={abOn} onChange={(e) => setAbOn(e.target.checked)} className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">A/B test the subject line</span>
              </label>
              {abOn && (
                <div className="space-y-2">
                  <p className={hint}>
                    Sends your <strong>Subject</strong> (A) and Subject B to a small slice of the audience now, then automatically emails the higher-opening subject to everyone else.
                  </p>
                  <div className="space-y-1">
                    <Label className="text-xs">Subject B (variant)</Label>
                    <Input value={subjectB} onChange={(e) => setSubjectB(e.target.value)} placeholder="An alternative subject line to test" />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Test slice (%)</Label>
                      <Input type="number" min={10} max={90} value={testPct} onChange={(e) => setTestPct(e.target.value)} className="h-8 w-24 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Decide after (hours)</Label>
                      <Input type="number" min={1} max={72} value={decideHours} onChange={(e) => setDecideHours(e.target.value)} className="h-8 w-28 text-xs" />
                    </div>
                    <Button size="sm" className="h-8 text-xs" onClick={startAb} disabled={busy != null || !emailReady || !subjectB.trim()}>{busy === "ab" ? "Starting…" : "Start A/B test"}</Button>
                  </div>
                  {abMsg && <p className={`text-xs ${abMsg.ok ? "text-emerald-600" : "text-destructive"}`}>{abMsg.text}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
