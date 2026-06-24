import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "./account-form";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-muted-foreground">
          {user.name} · {user.email} · {user.role}
        </p>
      </div>
      <AccountForm email={user.email} />
    </div>
  );
}
