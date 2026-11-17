export const PROJECT_NAME_REGEX = /^[a-zA-Z0-9 _.-]+$/;

const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * Produces a deterministic, cross-platform folder/filename segment.
 */
export function slug(input: string, fallback = "unnamed"): string {
  const cleaned = input
    .trim()
    .replace(/[^a-zA-Z0-9 _.-]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  if (!cleaned) return fallback;
  if (WINDOWS_RESERVED.has(cleaned.toLowerCase())) return `_${cleaned}`;
  return cleaned.slice(0, 80);
}
