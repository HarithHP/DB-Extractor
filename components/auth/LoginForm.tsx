"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FolderOpen, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDangerDialog } from "@/components/ui/confirm-danger-dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert, Spinner } from "@/components/ui/misc";
import { inspectBootState, resetVault, unlockVault } from "@/lib/services/auth.service";
import { storage } from "@/lib/storage";

export function LoginForm({ initialUsername, initialRootName, needsPermission }: {
  initialUsername?: string;
  initialRootName: string;
  needsPermission?: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = React.useState(initialUsername ?? "");
  const [rootName, setRootName] = React.useState(initialRootName);
  const [permNeeded, setPermNeeded] = React.useState(Boolean(needsPermission));
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);

  async function handleGrantPermission() {
    setError(null);
    setBusy(true);
    try {
      const ok = await storage.requestPermission();
      if (!ok) {
        setError("Folder access was not granted.");
        return;
      }
      const state = await inspectBootState();
      if (state.kind === "needs-onboarding") {
        router.replace("/onboarding");
        return;
      }
      if (state.kind === "needs-login") {
        setUsername(state.username);
        setRootName(state.rootName);
        setPermNeeded(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await unlockVault(password);
      router.replace("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2 text-primary">
            <KeyRound className="size-5" />
            <span className="text-xs font-medium uppercase tracking-wider">Locked vault</span>
          </div>
          <CardTitle>{username ? `Welcome back, ${username}` : "Unlock your vault"}</CardTitle>
          <CardDescription>
            Enter your master password to unwrap the Data Encryption Key into memory for this session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Folder:</span>
              <strong className="truncate font-mono">{rootName}</strong>
            </span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => router.push("/setup")}>
              Switch
            </Button>
          </div>

          {permNeeded ? (
            <div className="space-y-3">
              <Alert>
                Your browser needs permission again after a reload to access <strong className="font-mono">{rootName}</strong>.
              </Alert>
              <Button type="button" className="w-full" onClick={handleGrantPermission} disabled={busy}>
                {busy ? <Spinner /> : null}
                Grant folder access
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Master password" htmlFor="login-password">
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              {error ? <Alert variant="destructive">{error}</Alert> : null}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Spinner /> : null}
                {busy ? "Unlocking..." : "Unlock vault"}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="justify-between text-xs text-muted-foreground">
          <span>Forgot your password?</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs text-destructive" onClick={() => setResetOpen(true)}>
            Reset vault (wipes credentials)
          </Button>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset vault?"
        description={
          <>
            This permanently deletes <code className="font-mono">config/user.json</code> and the entire{" "}
            <code className="font-mono">vault/</code> directory. Existing SQL exports in{" "}
            <code className="font-mono">exports/</code> are kept.
          </>
        }
        confirmPhrase="RESET VAULT"
        confirmLabel="Wipe vault"
        onConfirm={async () => {
          await resetVault();
          router.replace("/onboarding");
        }}
      />
    </>
  );
}
