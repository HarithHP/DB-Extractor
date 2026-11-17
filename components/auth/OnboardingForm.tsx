"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, FolderOpen, ShieldCheck } from "lucide-react";
import { PasswordStrength } from "./PasswordStrength";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert, Spinner } from "@/components/ui/misc";
import { createVaultUser } from "@/lib/services/auth.service";

export function OnboardingForm({ rootName }: { rootName: string }) {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Master password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await createVaultUser(username, password);
      router.replace("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-1 flex items-center gap-2 text-primary">
          <ShieldCheck className="size-5" />
          <span className="text-xs font-medium uppercase tracking-wider">First-run setup</span>
        </div>
        <CardTitle>Create your local vault</CardTitle>
        <CardDescription>
          Your master password derives a 256-bit key in memory (PBKDF2-SHA256, 600,000 iterations). It is never written
          to disk and cannot be recovered if forgotten.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Storage root:</span>
              <strong className="truncate font-mono">{rootName}</strong>
            </span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => router.push("/setup")}>
              Change
            </Button>
          </div>

          <Field label="Username" htmlFor="onboard-username">
            <Input
              id="onboard-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice"
              autoComplete="username"
              required
            />
          </Field>

          <Field label="Master password" htmlFor="onboard-password">
            <div className="relative">
              <Input
                id="onboard-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
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
            <PasswordStrength password={password} />
          </Field>

          <Field
            label="Confirm master password"
            htmlFor="onboard-confirm"
            error={confirm && confirm !== password ? "Passwords do not match" : undefined}
          >
            <Input
              id="onboard-confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Deriving key & creating vault..." : "Create vault"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
