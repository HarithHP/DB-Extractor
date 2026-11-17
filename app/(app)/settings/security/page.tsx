"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/misc";
import { PropertyTable } from "@/components/ui/property-table";
import type { StoredUser } from "@/lib/schemas";
import { lockVault, readStoredUser } from "@/lib/services/auth.service";
import { formatDisplayDateTime } from "@/lib/utils/datetime";
import { useAuthStore } from "@/stores/auth.store";

interface ThreatRow {
  threat: string;
  covered: boolean;
}

const THREATS: ThreatRow[] = [
  { threat: "Casual access to files on this machine", covered: true },
  { threat: "Stolen copy of the vault/ folder", covered: true },
  { threat: "Accidental plaintext leakage of credentials or logs", covered: true },
  { threat: "OS-level attacker reading process memory", covered: false },
  { threat: "Malicious browser extensions with DOM access", covered: false },
  { threat: "Keyloggers", covered: false },
];

const threatColumns: DataTableColumn<ThreatRow>[] = [
  { id: "threat", header: "Threat", mobile: "title", cell: (r) => r.threat },
  {
    id: "covered",
    header: "Protected",
    align: "right",
    cell: (r) =>
      r.covered ? (
        <Badge variant="success">
          <ShieldCheck /> Yes
        </Badge>
      ) : (
        <Badge variant="warning">
          <ShieldAlert /> No
        </Badge>
      ),
  },
];

export default function SecuritySettingsPage() {
  const router = useRouter();
  const dek = useAuthStore((s) => s.dek);
  const unlockedAt = useAuthStore((s) => s.unlockedAt);
  const [user, setUser] = React.useState<StoredUser | null>(null);

  React.useEffect(() => {
    readStoredUser().then(setUser).catch(() => {});
  }, []);

  function onLock() {
    lockVault();
    router.replace("/login");
  }

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/settings">
          <ArrowLeft /> Back to settings
        </Link>
      </Button>
      <PageHeader
        icon={<KeyRound />}
        eyebrow="Settings"
        title="Security & vault"
        description="Key derivation parameters and the current session."
        actions={
          <Button variant="destructive-soft" leftIcon={<Lock />} onClick={onLock}>
            Lock vault now
          </Button>
        }
      />

      <SectionCard
        icon={<ShieldCheck />}
        title="Vault encryption"
        description={
          <>
            Read from <code className="font-mono">config/user.json</code>. No plaintext password is ever stored.
          </>
        }
      >
        <PropertyTable
          caption="Vault encryption parameters"
          rows={[
            { key: "user", label: "Username", value: <span className="font-mono">{user?.username ?? "—"}</span> },
            {
              key: "kdf",
              label: "Key derivation",
              value: "PBKDF2-SHA256",
              hint: `${(user?.iterations ?? 600_000).toLocaleString()} iterations, 32-byte salt`,
            },
            { key: "cipher", label: "Envelope cipher", value: "AES-256-GCM, 96-bit random IV" },
            { key: "jwt", label: "Integrity layer", value: "HS256 JWT signed with the DEK" },
            { key: "kid", label: "Active key ID", value: <code className="font-mono">{dek?.kid ?? "locked"}</code> },
            { key: "created", label: "Vault created", value: formatDisplayDateTime(user?.createdAt) },
            {
              key: "session",
              label: "Session",
              value: dek ? (
                <Badge variant="success" dot>
                  Unlocked {unlockedAt ? `since ${new Date(unlockedAt).toLocaleTimeString()}` : ""}
                </Badge>
              ) : (
                <Badge variant="secondary" dot>
                  Locked
                </Badge>
              ),
              hint: "Keys live in memory only; reloading the page locks the vault.",
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        icon={<ShieldAlert />}
        title="Threat model"
        description="What the vault does and does not defend against."
        footer={
          <span className="text-xs text-muted-foreground">
            Password rotation and idle auto-lock are scheduled for Milestone 6.
          </span>
        }
      >
        <DataTable columns={threatColumns} rows={THREATS} rowKey={(r) => r.threat} caption="Threat model" dense />
      </SectionCard>
    </div>
  );
}
