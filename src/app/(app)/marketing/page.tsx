import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMarketingConfig, getMarketingRecipients } from "@/lib/marketing";
import { getCampaignDraft } from "@/lib/marketing-campaign";
import { getCampaignTemplates, getScheduledCampaigns, getCampaignSends } from "@/lib/marketing-store";
import { emailConfigured } from "@/lib/email/resend";
import { config as appConfig } from "@/lib/config";
import { MarketingWorkspace } from "./marketing-workspace";
import { CampaignBuilder } from "./campaign-builder";
import { CampaignActivity } from "./campaign-activity";
import {
  saveMarketingSettingsAction,
  saveCampaignDraftAction,
  previewCampaignBuilderAction,
  previewCampaignRecipientsAction,
  sendCampaignBuilderAction,
  sendCampaignTestAction,
  saveCampaignTemplateAction,
  deleteCampaignTemplateAction,
  duplicateCampaignTemplateAction,
  scheduleCampaignAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const user = await getCurrentUser();
  if (!user || !(isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER")) redirect("/dashboard");

  const [config, draft, templates, scheduled, sends, listRecipients, allRecipients] = await Promise.all([
    getMarketingConfig(),
    getCampaignDraft(),
    getCampaignTemplates(),
    getScheduledCampaigns(),
    getCampaignSends(),
    getMarketingRecipients("list"),
    getMarketingRecipients("all"),
  ]);
  const emailReady = emailConfigured() && !!appConfig.followUpFromEmail;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">Email marketing</h1>
        <p className="text-sm text-muted-foreground">
          Build and send a customized campaign to your client list, or keep a gentle automatic check-in running.
          Every send skips clients who&rsquo;ve opted out and those with no email.
        </p>
      </div>

      <CampaignBuilder
        draft={draft}
        templates={templates}
        listCount={listRecipients.length}
        allCount={allRecipients.length}
        emailReady={emailReady}
        onSaveDraft={saveCampaignDraftAction}
        onPreview={previewCampaignBuilderAction}
        onPreviewRecipients={previewCampaignRecipientsAction}
        onSend={sendCampaignBuilderAction}
        onTest={sendCampaignTestAction}
        onSaveTemplate={saveCampaignTemplateAction}
        onDeleteTemplate={deleteCampaignTemplateAction}
        onDuplicateTemplate={duplicateCampaignTemplateAction}
        onSchedule={scheduleCampaignAction}
      />

      <CampaignActivity scheduled={scheduled} sends={sends} />

      <MarketingWorkspace
        config={config}
        listCount={listRecipients.length}
        emailReady={emailReady}
        onSaveSettings={saveMarketingSettingsAction}
      />
    </div>
  );
}
