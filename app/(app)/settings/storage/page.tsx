"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderOpen, FolderTree, HardDrive, Lock, LockOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/misc";
import { PropertyTable } from "@/components/ui/property-table";
import { lockVault } from "@/lib/services/auth.service";
import { storage, type PermissionState } from "@/lib/storage";

const BACKEND_LABELS: Record<string, string> = {
  "fs-access": "Local disk folder (File System Access API)",
  "electron-fs": "Local disk folder (desktop Node.js filesystem)",
  opfs: "In-browser (Origin Private File System)",
  idb: "In-browser (IndexedDB)",
  memory: "In-memory (tests)",
};

interface LayoutRow {
  path: string;
  purpose: string;
  encrypted: boolean;
}

const LAYOUT: LayoutRow[] = [
  { path: "config/user.json", purpose: "Username, salt, KDF parameters, verifier, wrapped DEK", encrypted: true },
  { path: "config/meta.json", purpose: "App and schema version", encrypted: false },
  { path: "config/settings.json", purpose: "Default extraction options and logging preference", encrypted: false },
  { path: "vault/projects.enc", purpose: "Project list (JWT inside an AES-GCM envelope)", encrypted: true },
  { path: "vault/<id>/conn.enc", purpose: "Per-project connection credentials", encrypted: true },
  { path: "exports/<project>/<db>/<date>/<ts>/", purpose: "Immutable SQL snapshots + manifest.json", encrypted: false },
  { path: "logs/<date>.log", purpose: "Optional redacted session logs", encrypted: false },
];

const layoutColumns: DataTableColumn<LayoutRow>[] = [
  {
    id: "path",
    header: "Path",
    mobile: "title",
    cell: (r) => <code className="font-mono text-xs font-medium">{r.path}</code>,
  },
  { id: "purpose", header: "Contents", cell: (r) => <span className="text-muted-foreground">{r.purpose}</span> },
  {
    id: "encrypted",
    header: "At rest",
    align: "right",
    cell: (r) =>
      r.encrypted ? (
        <Badge variant="success">
          <Lock /> Encrypted
        </Badge>
      ) : (
        <Badge variant="secondary">
          <LockOpen /> Plaintext
        </Badge>
      ),
  },
];

const PERMISSION_BADGE: Record<PermissionState, React.ReactNode> = {
  granted: <Badge variant="success" dot>Granted</Badge>,
  prompt: <Badge variant="warning" dot>Needs re-grant</Badge>,
  denied: <Badge variant="destructive" dot>Denied</Badge>,
  "no-root": <Badge variant="secondary" dot>Not selected</Badge>,
};

export default function StorageSettingsPage() {
  const router = useRouter();
  const [rootName, setRootName] = React.useState("");
  const [permission, setPermission] = React.useState<PermissionState | null>(null);

  React.useEffect(() => {
    storage.getRootName().then(setRootName).catch(() => {});
    storage.getPermissionState().then(setPermission).catch(() => {});
  }, []);

  function onSwitchRoot() {
    lockVault();
    router.push("/setup");
  }

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/settings">
          <ArrowLeft /> Back to settings
        </Link>
      </Button>
      <PageHeader
        icon={<HardDrive />}
        eyebrow="Settings"
        title="Storage location"
        description="Where HHP reads and writes your vault and exports."
      />

      <SectionCard
        icon={<FolderOpen />}
        title="Current storage root"
        description="Switching folders locks the session and reopens the storage selector."
        actions={
          <Button variant="outline" leftIcon={<FolderOpen />} onClick={onSwitchRoot}>
            Switch folder...
          </Button>
        }
      >
        <PropertyTable
          caption="Storage details"
          rows={[
            { key: "root", label: "Root", value: <span className="font-mono">{rootName || "—"}</span> },
            { key: "backend", label: "Backend", value: BACKEND_LABELS[storage.backend] ?? storage.backend },
            { key: "permission", label: "Permission", value: permission ? PERMISSION_BADGE[permission] : "—" },
          ]}
        />
      </SectionCard>

      <SectionCard
        icon={<FolderTree />}
        title="Folder layout"
        description="Exports stay plaintext so they can be read and diffed; secrets are encrypted."
      >
        <DataTable columns={layoutColumns} rows={LAYOUT} rowKey={(r) => r.path} caption="Storage folder layout" dense />
      </SectionCard>
    </div>
  );
}
