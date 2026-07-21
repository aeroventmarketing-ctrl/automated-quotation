"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Inbox, FileText, BellRing, ClipboardList, Boxes, Package, ClipboardCheck, ShoppingCart, Wallet, Percent, Gauge, Wrench, Settings, LogOut, UserCog } from "lucide-react";
import type { Role } from "@prisma/client";

export const NAV = [
  { href: "/management", label: "Management Dashboard", icon: Gauge, roles: ["ADMIN"] },
  { href: "/dashboard", label: "Sales Dashboard", icon: LayoutDashboard, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/inquiries", label: "Inquiries", icon: Inbox, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/quotations", label: "Quotations", icon: FileText, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/follow-ups", label: "Follow-ups", icon: BellRing, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/orders", label: "Orders", icon: ClipboardList, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/inventory", label: "Inventory", icon: Boxes, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/products", label: "Products", icon: Package, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/requisitions", label: "Requisitions", icon: ClipboardCheck, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/cash-requests", label: "Cash Requests", icon: Wallet, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/commissions", label: "Commissions", icon: Percent, roles: ["SALES", "ENGINEER", "ADMIN", "OTHER"] },
  { href: "/tools", label: "HVAC Tools", icon: Wrench, roles: ["SALES", "ENGINEER", "ADMIN"] },
  { href: "/admin", label: "Admin", icon: Settings, roles: ["ADMIN"] },
] as const;

export function AppNav({ role, name }: { role: Role; name: string }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => (n.roles as readonly string[]).includes(role));

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/aerovent-logo.jpg"
          alt="Aerovent Fans and Blowers Manufacturing"
          className="h-auto w-full"
        />
        <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {role}
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 px-2 text-xs text-muted-foreground">{name}</div>
        <Link
          href="/account"
          className="mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <UserCog className="h-4 w-4" />
          Account
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
