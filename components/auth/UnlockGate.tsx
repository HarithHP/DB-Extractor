"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FullScreenLoader } from "@/components/ui/misc";
import { useAuthStore } from "@/stores/auth.store";

export function UnlockGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const dek = useAuthStore((s) => s.dek);

  React.useEffect(() => {
    if (!dek) router.replace("/login");
  }, [dek, router]);

  if (!dek) return <FullScreenLoader label="Checking vault..." />;
  return <>{children}</>;
}
