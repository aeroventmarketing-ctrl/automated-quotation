import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMarketingConfig, getMarketingRecipients } from "@/lib/marketing";
import { emailConfigured } from "@/lib/email/resend";
import { config as appConfig } from "@/lib/config";
import { MarketingWorkspace } from "./marketing-workspace";
import { saveMarketingSettingsAction, previewCampaignAction, sendCampaignAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const user = await getCurrentUser();
  if (!user || !(isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER")) redirect("/dashboard");

  const [config, listRecipients, allRecipients] = await Promise.all([
    getMarketingConfig(),
    getMarketingRecipients("list"),
    getMarketingRecipients("all"),
  ]);
  const emailReady = emailConfigured() && !!appConfig.followUpFromEmail;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold">Email marketing</h1>
        <p className="text-sm text-muted-foreground">
          Reach your client list directly — send a campaign now, or keep a gentle automatic check-in running.
          Every send skips clients who&rsquo;ve opted out and those with no email.
        </p>
      </div>
      <MarketingWorkspace
        config={config}
        listCount={listRecipients.length}
        allCount={allRecipients.length}
        emailReady={emailReady}
        onSaveSettings={saveMarketingSettingsAction}
        onPreview={previewCampaignAction}
        onSend={sendCampaignAction}
      />
    </div>
  );
}
