import { Database } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col justify-between p-4 sm:p-6">
      <header className="mx-auto flex w-full max-w-md items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[image:var(--gradient-brand)] text-primary-foreground shadow-raised">
            <Database className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none tracking-tight">HHP Database Extractor</p>
            <p className="mt-1 text-xs text-muted-foreground">Local-first schema vault &amp; exporter</p>
          </div>
        </div>
        <ThemeToggle />
      </header>
      <main className="my-auto flex w-full justify-center py-6">{children}</main>
      <footer className="mx-auto max-w-md text-center text-xs text-muted-foreground">
        Personal use only. Credentials stay on your device; forgotten master passwords cannot be recovered.
      </footer>
    </div>
  );
}
