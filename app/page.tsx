"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FullScreenLoader } from "@/components/ui/misc";
import { inspectBootState } from "@/lib/services/auth.service";

export default function HomePage() {
  const router = useRouter();

  React.useEffect(() => {
    let active = true;
    inspectBootState()
      .then((state) => {
        if (!active) return;
        switch (state.kind) {
          case "needs-setup":
            router.replace("/setup");
            break;
          case "needs-onboarding":
            router.replace("/onboarding");
            break;
          case "needs-permission":
          case "needs-login":
            router.replace("/login");
            break;
          case "unlocked":
            router.replace("/projects");
            break;
        }
      })
      .catch(() => {
        if (active) router.replace("/setup");
      });
    return () => {
      active = false;
    };
  }, [router]);

  return <FullScreenLoader label="Starting HHP Database Extractor..." />;
}
