"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { FullScreenLoader } from "@/components/ui/misc";
import { inspectBootState } from "@/lib/services/auth.service";

export default function LoginPage() {
  const router = useRouter();
  const [state, setState] = React.useState<{
    username?: string;
    rootName: string;
    needsPermission?: boolean;
  } | null>(null);

  React.useEffect(() => {
    inspectBootState().then((boot) => {
      if (boot.kind === "needs-setup") router.replace("/setup");
      else if (boot.kind === "needs-onboarding") router.replace("/onboarding");
      else if (boot.kind === "unlocked") router.replace("/projects");
      else if (boot.kind === "needs-permission") setState({ rootName: boot.rootName, needsPermission: true });
      else setState({ username: boot.username, rootName: boot.rootName });
    });
  }, [router]);

  if (!state) return <FullScreenLoader />;
  return (
    <LoginForm
      initialUsername={state.username}
      initialRootName={state.rootName}
      needsPermission={state.needsPermission}
    />
  );
}
