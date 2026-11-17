"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, HardDrive, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, Spinner } from "@/components/ui/misc";
import { inspectBootState } from "@/lib/services/auth.service";
import {
  isElectronDesktop,
  selectStorageBackend,
  supportsDirectoryPicker,
  supportsOpfs,
} from "@/lib/storage";

const noopSubscribe = () => () => {};

export default function SetupPage() {
  const router = useRouter();
  const isDesktop = React.useSyncExternalStore(noopSubscribe, isElectronDesktop, () => false);
  const hasFsAccess = React.useSyncExternalStore(noopSubscribe, supportsDirectoryPicker, () => false);
  const hasOpfs = React.useSyncExternalStore(noopSubscribe, supportsOpfs, () => false);
  const canPickLocalFolder = isDesktop || hasFsAccess;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function afterPick() {
    const state = await inspectBootState();
    if (state.kind === "needs-onboarding") router.replace("/onboarding");
    else if (state.kind === "needs-login" || state.kind === "needs-permission") router.replace("/login");
    else if (state.kind === "unlocked") router.replace("/projects");
  }

  async function pickLocalFolder() {
    setError(null);
    setBusy(true);
    try {
      const svc = await selectStorageBackend(isDesktop ? "electron-fs" : "fs-access");
      await svc.pickRoot();
      await afterPick();
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function useBrowserStorage() {
    setError(null);
    setBusy(true);
    try {
      const svc = await selectStorageBackend(hasOpfs ? "opfs" : "idb");
      await svc.pickRoot();
      await afterPick();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Choose where HHP stores your vault &amp; exports</CardTitle>
        <CardDescription>
          HHP writes <code className="font-mono">config/</code>, <code className="font-mono">vault/</code>, and{" "}
          <code className="font-mono">exports/</code> inside the location you choose.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canPickLocalFolder ? (
          <div className="space-y-2 rounded-lg border p-3.5">
            <div className="flex items-center gap-2 font-medium">
              <HardDrive className="size-4 text-primary" />
              <span>Local disk folder (recommended on desktop)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isDesktop
                ? "Pick a folder such as C:\\HHP. The desktop app writes with full disk access (no browser permission prompts)."
                : "Create a folder such as C:\\HHP (or ~/HHP) and select it. Browsers block picking a drive root like C:\\ directly."}
            </p>
            <Button type="button" className="w-full" onClick={pickLocalFolder} disabled={busy}>
              {busy ? <Spinner /> : <FolderOpen />}
              Choose local folder...
            </Button>
          </div>
        ) : null}

        {!isDesktop ? (
          <div className="space-y-2 rounded-lg border p-3.5">
            <div className="flex items-center gap-2 font-medium">
              <Smartphone className="size-4 text-primary" />
              <span>In-browser storage ({hasOpfs ? "Origin Private File System" : "IndexedDB"})</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Works on mobile browsers, Safari, and Firefox. Everything stays on this device inside browser storage, and
              every extraction can be downloaded as a <code className="font-mono">.zip</code>.
            </p>
            <Button
              type="button"
              variant={canPickLocalFolder ? "outline" : "default"}
              className="w-full"
              onClick={useBrowserStorage}
              disabled={busy}
            >
              {busy ? <Spinner /> : null}
              Use in-browser storage
            </Button>
          </div>
        ) : null}

        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </CardContent>
    </Card>
  );
}
