import { storage } from "@/lib/storage";
import { useLogStore, type LogEntry, type LogLevel } from "@/stores/log.store";

const SECRET_KEYS = /^(password|passwd|pwd|secret|token|jwt|dek|masterkey|connectionstring|uri|url|ct|iv|salt|authorization)$/i;

const INLINE_PATTERNS: [RegExp, string][] = [
  // Standard JWT (three base64url segments).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED:JWT]"],
  // Connection URIs with credentials: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1[REDACTED]$3"],
  // Key/value secrets in connection strings or query params.
  [/\b(password|passwd|pwd|secret|token|apikey|api_key)\s*([=:])\s*([^\s;&"',}]+)/gi, "$1$2[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
];

let registeredSecrets = new Set<string>();

/**
 * Registers dynamic secret values (e.g. a connection password) so that even if an
 * underlying library echoes the raw value in an error message, it gets scrubbed.
 */
export function registerSecretForRedaction(secret?: string | null) {
  if (secret && secret.length >= 3) registeredSecrets.add(secret);
}

export function clearRegisteredSecrets() {
  registeredSecrets = new Set();
}

export function redactString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of INLINE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  for (const secret of registeredSecrets) {
    if (secret && out.includes(secret)) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out;
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redactValue(v, seen);
  }
  return out;
}

function formatDetails(details: unknown): string | undefined {
  if (details === undefined) return undefined;
  const clean = redactValue(details);
  return typeof clean === "string" ? clean : JSON.stringify(clean);
}

let diskLoggingEnabled = false;

export function setDiskLoggingEnabled(enabled: boolean) {
  diskLoggingEnabled = enabled;
}

async function appendToDisk(entry: LogEntry) {
  if (!diskLoggingEnabled) return;
  try {
    const date = entry.timestamp.slice(0, 10);
    const path = `logs/${date}.log`;
    const line = `${entry.timestamp} [${entry.level.toUpperCase()}] (${entry.scope}) ${entry.message}${
      entry.details ? ` | ${entry.details}` : ""
    }\n`;
    const prev = (await storage.exists(path)) ? await storage.readTextFile(path) : "";
    await storage.writeTextFile(path, prev + line);
  } catch {
    // Disk logging is best-effort and must never break an operation.
  }
}

function write(level: LogLevel, scope: string, message: string, details?: unknown): LogEntry {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    scope,
    message: redactString(message),
    details: formatDetails(details),
  };
  useLogStore.getState().append(entry);
  void appendToDisk(entry);
  return entry;
}

export const logger = {
  info: (scope: string, message: string, details?: unknown) => write("info", scope, message, details),
  warn: (scope: string, message: string, details?: unknown) => write("warn", scope, message, details),
  error: (scope: string, message: string, details?: unknown) => write("error", scope, message, details),
};
