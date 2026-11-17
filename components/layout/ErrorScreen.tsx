"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw, RotateCcw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { describeBridgeError, isServerUnreachable } from "@/lib/adapters/remote";
import { logger } from "@/lib/services/log.service";

/** Recoverable fallback shown by app/error.tsx and app/global-error.tsx. */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const offline = isServerUnreachable(error);

  React.useEffect(() => {
    logger.error("app", offline ? "Lost connection to the local app server" : "Unhandled UI error", {
      name: error.name,
      message: error.message,
      digest: error.digest,
    });
  }, [error, offline]);

  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/15 ring-inset [&_svg]:size-5">
            {offline ? <WifiOff /> : <AlertTriangle />}
          </div>
          <div className="space-y-1">
            <h1 className="text-section-title font-semibold tracking-tight">
              {offline ? "Can't reach the app server" : "Something went wrong"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {offline
                ? describeBridgeError(error)
                : "This screen hit an unexpected error. Your vault and saved projects are not affected."}
            </p>
          </div>
        </CardHeader>
        {!offline && error.message ? (
          <CardContent>
            <pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {error.message}
              {error.digest ? `\n(ref ${error.digest})` : ""}
            </pre>
          </CardContent>
        ) : null}
        <CardFooter className="justify-between">
          <p className="text-xs text-muted-foreground">Reloading locks the vault.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" leftIcon={<RotateCcw />} onClick={reset}>
              Try again
            </Button>
            <Button size="sm" leftIcon={<RefreshCw />} onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
