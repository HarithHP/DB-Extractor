"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, FolderOpen, KeyRound, Palette, Save, ScrollText, Settings, SlidersHorizontal } from "lucide-react";
import { OptionsForm } from "@/components/extraction/OptionsForm";
import { THEME_STORAGE_KEY } from "@/components/layout/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Card, IconTile, SectionCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, PageHeader } from "@/components/ui/misc";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/schemas";
import { loadSettings, saveSettings } from "@/lib/services/settings.service";
import { storage } from "@/lib/storage";

export default function SettingsPage() {
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [rootName, setRootName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [savedNotice, setSavedNotice] = React.useState(false);

  React.useEffect(() => {
    loadSettings().then(setSettings).catch(() => {});
    storage.getRootName().then(setRootName).catch(() => {});
  }, []);

  async function onSave() {
    setSaving(true);
    setSavedNotice(false);
    try {
      await saveSettings(settings);
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Settings />}
        eyebrow="Preferences"
        title="Settings"
        description="Appearance, storage location, logging, and default extraction options."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NavCard
          href="/settings/storage"
          icon={<FolderOpen />}
          title="Storage location"
          description={rootName ? <span className="font-mono">{rootName}</span> : "Where the vault and exports live"}
        />
        <NavCard
          href="/settings/security"
          icon={<KeyRound />}
          title="Security & vault"
          description="Key derivation parameters and session lock"
        />
      </div>

      <SectionCard
        icon={<Palette />}
        title="Appearance"
        description={
          <>
            Saved in this browser (<code className="font-mono">{THEME_STORAGE_KEY}</code>) and applied before the page
            paints, so there is no flash on reload.
          </>
        }
        actions={<ThemeToggle variant="segmented" />}
      />

      <SectionCard
        icon={<ScrollText />}
        title="Logging"
        description="Session logs always stay in memory; disk logging is optional."
      >
        <label htmlFor="settings-disk-logs" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 hover:bg-muted/40">
          <Checkbox
            id="settings-disk-logs"
            className="mt-0.5"
            checked={settings.writeDiskLogs}
            onCheckedChange={(c) => setSettings({ ...settings, writeDiskLogs: Boolean(c) })}
          />
          <div>
            <p className="text-sm font-medium leading-none">
              Write redacted logs to <code className="font-mono">logs/YYYY-MM-DD.log</code>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Passwords, connection strings, and JWTs are scrubbed before writing. Saved with the button below.
            </p>
          </div>
        </label>
      </SectionCard>

      <SectionCard
        icon={<SlidersHorizontal />}
        title="Default extraction options"
        description="Pre-filled whenever you open the extraction wizard."
        footer={
          <>
            {savedNotice ? <span className="text-sm text-success">Settings saved.</span> : null}
            <Button className="ml-auto" loading={saving} leftIcon={<Save />} onClick={onSave}>
              Save settings
            </Button>
          </>
        }
      >
        <OptionsForm
          value={settings.defaultOptions}
          onChange={(defaultOptions) => {
            setSavedNotice(false);
            setSettings({ ...settings, defaultOptions });
          }}
        />
        {savedNotice ? null : (
          <Alert variant="info" className="mt-4">
            Changes apply to new extractions only; existing snapshots are never rewritten.
          </Alert>
        )}
      </SectionCard>
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <Link href={href} className="group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="flex items-center gap-3 p-3.5 transition-all group-hover:-translate-y-px group-hover:border-primary/40 group-hover:shadow-raised">
        <IconTile>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </Card>
    </Link>
  );
}
