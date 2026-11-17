"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { OnboardingForm } from "@/components/auth/OnboardingForm";
import { FullScreenLoader } from "@/components/ui/misc";
import { inspectBootState } from "@/lib/services/auth.service";

export default function OnboardingPage() {
  const router = useRouter();
  const [rootName, setRootName] = React.useState<string | null>(null);

  React.useEffect(() => {
    inspectBootState().then((state) => {
      if (state.kind === "needs-setup") router.replace("/setup");
      else if (state.kind === "needs-login" || state.kind === "needs-permission") router.replace("/login");
      else if (state.kind === "unlocked") router.replace("/projects");
      else setRootName(state.rootName);
    });
  }, [router]);

  if (!rootName) return <FullScreenLoader />;
  return <OnboardingForm rootName={rootName} />;
}
