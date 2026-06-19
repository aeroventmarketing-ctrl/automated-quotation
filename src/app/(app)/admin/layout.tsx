import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/catalogue", label: "Catalogue" },
  { href: "/admin/ratings", label: "Rating points" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/import", label: "Import CSV" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <nav className="flex flex-wrap gap-2 border-b pb-2">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
