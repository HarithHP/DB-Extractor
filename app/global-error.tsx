"use client";

import { ErrorScreen } from "@/components/layout/ErrorScreen";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <ErrorScreen error={error} reset={reset} />
        </ThemeProvider>
      </body>
    </html>
  );
}
