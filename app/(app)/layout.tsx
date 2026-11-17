"use client";

import { UnlockGate } from "@/components/auth/UnlockGate";
import { Sidebar } from "@/components/layout/Sidebar";
import { TabBar } from "@/components/layout/TabBar";
import { TopBar } from "@/components/layout/TopBar";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <UnlockGate>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(var(--tabbar-height)+1.5rem)] sm:px-6 md:pb-10">
            {children}
          </main>
        </div>
        <TabBar />
      </div>
    </UnlockGate>
  );
}
