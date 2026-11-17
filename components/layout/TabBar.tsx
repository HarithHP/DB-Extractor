"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, PRIMARY_NAV } from "./nav-items";
import { cn } from "@/lib/utils/cn";

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Bottom navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 pb-safe backdrop-blur-xl md:hidden"
    >
      <div className="grid h-[var(--tabbar-height)] grid-cols-3 px-2">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/12",
                )}
              >
                <Icon className="size-[1.125rem]" />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
