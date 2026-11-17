"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Database, Lock, ScrollText } from "lucide-react";
import { DESKTOP_NAV, isNavActive } from "./nav-items";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { lockVault } from "@/lib/services/auth.service";

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const current = DESKTOP_NAV.find((item) => isNavActive(pathname, item.href));

  function handleLock() {
    lockVault();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-[var(--topbar-height)] items-center justify-between border-b bg-background/75 px-4 backdrop-blur-xl md:px-6">
      <Link href="/projects" className="flex items-center gap-2 md:hidden">
        <div className="flex size-7 items-center justify-center rounded-lg bg-[image:var(--gradient-brand)] text-primary-foreground shadow-sm ring-1 ring-white/15 ring-inset">
          <Database className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">HHP Extractor</span>
      </Link>

      <p className="hidden text-sm text-muted-foreground md:block">
        <span className="text-foreground">{current?.label ?? "Workspace"}</span>
      </p>

      <div className="flex items-center gap-1">
        <Button
          asChild
          variant={pathname.startsWith("/logs") ? "soft" : "ghost"}
          size="icon"
          className="md:hidden"
          title="Session logs"
        >
          <Link href="/logs" aria-label="Session logs">
            <ScrollText />
          </Link>
        </Button>
        <ThemeToggle />
        <Button variant="ghost" size="icon" className="md:hidden" onClick={handleLock} aria-label="Lock vault" title="Lock vault">
          <Lock />
        </Button>
      </div>
    </header>
  );
}
