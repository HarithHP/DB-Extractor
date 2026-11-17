/**
 * Formats a Date into the date folder (`2026-10-19`) and UTC timestamp folder
 * (`2026-10-19T14-32-08Z`) described in PROJECT.md §3.
 */
export function formatSnapshotTimestamp(date = new Date()): {
  iso: string;
  dateFolder: string;
  timestampFolder: string;
} {
  const iso = date.toISOString();
  const dateFolder = iso.slice(0, 10);
  const timePart = iso.slice(11, 19).replaceAll(":", "-");
  return {
    iso,
    dateFolder,
    timestampFolder: `${dateFolder}T${timePart}Z`,
  };
}

export function formatDisplayDateTime(iso?: string): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(2)} s`;
}
