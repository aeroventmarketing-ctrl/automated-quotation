"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "./app-nav";
import type { Role } from "@prisma/client";

/** Hamburger menu for the mobile top bar (the sidebar is hidden below md). */
export function MobileNav({ role, name }: { role: Role; name: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = NAV.filter((n) => (n.roles as readonly string[]).includes(role));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        className="rounded-md p-1 text-foreground hover:bg-accent"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-md border bg-background p-2 shadow-lg">
            <div className="px-3 pb-2 text-xs text-muted-foreground">
              {name} · {role}
            </div>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
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
            <div className="my-1 border-t" />
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
        </>
      )}
    </div>
  );
}
