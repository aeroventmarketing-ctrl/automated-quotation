import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    // Authenticated in Supabase but no matching app User row, or not signed in.
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
        <AppNav role={user.role} name={user.name} />
      </aside>
      <main className="flex-1 overflow-x-hidden">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between border-b bg-background px-4 py-3 md:hidden">
          <span className="font-bold">AeroQuote</span>
          <form action="/auth/signout" method="post">
            <button className="text-sm text-muted-foreground">Sign out</button>
          </form>
        </div>
        <div className="mx-auto max-w-6xl p-4 md:p-8">{children}</div>
      </main>
    </div>
  );
}
