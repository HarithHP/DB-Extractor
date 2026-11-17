"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert, Spinner } from "@/components/ui/misc";

export function ConfirmDangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel = "Delete",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** If set, the user must type this exact phrase before confirming. */
  confirmPhrase?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
    onOpenChange(next);
  }

  const canConfirm = !confirmPhrase || typed.trim() === confirmPhrase;

  async function handleConfirm() {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {confirmPhrase ? (
          <Field
            label={`Type "${confirmPhrase}" to confirm`}
            htmlFor="danger-confirm-input"
          >
            <Input
              id="danger-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder={confirmPhrase}
            />
          </Field>
        ) : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm} disabled={!canConfirm || busy}>
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
