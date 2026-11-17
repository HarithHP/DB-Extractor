"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Database, FolderOpen, Lock } from "lucide-react";
import { DESKTOP_NAV, isNavActive } from "./nav-items";
import { Button } from "@/components/ui/button";
import { lockVault } from "@/lib/services/auth.service";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/stores/auth.store";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const username = useAuthStore((s) => s.username);
  const [rootName, setRootName] = React.useState("");

  React.useEffect(() => {
    storage.getRootName().then(setRootName).catch(() => {});
  }, [pathname]);

  function handleLock() {
    lockVault();
    router.replace("/login");
  }

  return (
    <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-[var(--sidebar-width)] md:shrink-0 md:flex-col md:border-r md:bg-card/70 md:backdrop-blur-xl">
      <div className="flex h-[var(--topbar-height)] items-center gap-2.5 border-b px-4">
        <div className="flex size-7 items-center justify-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground shadow-sm ring-1 ring-white/15 ring-inset">
          <Database className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight tracking-tight">HHP Extractor</p>
          <p className="truncate text-xs text-muted-foreground">Local schema vault</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 p-2.5" aria-label="Primary">
        <p className="px-2.5 pt-1 pb-1.5 text-table-head font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Workspace
        </p>
        {DESKTOP_NAV.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {active ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden /> : null}
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t p-2.5">
        <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold uppercase text-primary">
            {(username ?? "?").slice(0, 1)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{username ?? "Vault"}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" title={rootName}>
              <FolderOpen className="size-3 shrink-0" />
              <span className="truncate font-mono">{rootName || "Storage"}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" fullWidth leftIcon={<Lock />} onClick={handleLock}>
          Lock vault
        </Button>
      </div>
    </aside>
  );
}
