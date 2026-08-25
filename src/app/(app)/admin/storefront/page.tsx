import { getStoreTheme } from "@/lib/store-theme";
import { StorefrontEditor } from "./storefront-editor";

export const dynamic = "force-dynamic";

/** Admin → Storefront: the shop's look, copy and search/AI text. */
export default async function StorefrontAdminPage() {
  const theme = await getStoreTheme();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Storefront</h1>
        <p className="text-sm text-muted-foreground">
          The public shop&rsquo;s look and words. Products themselves are listed under Store products.
        </p>
      </div>
      <StorefrontEditor initial={theme} />
    </div>
  );
}
