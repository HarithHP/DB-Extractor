import { AppSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from "@/lib/schemas";
import { setDiskLoggingEnabled } from "@/lib/services/log.service";
import { storage } from "@/lib/storage";

const SETTINGS_PATH = "config/settings.json";

export async function loadSettings(): Promise<AppSettings> {
  try {
    if (!(await storage.exists(SETTINGS_PATH))) return DEFAULT_APP_SETTINGS;
    const raw = JSON.parse(await storage.readTextFile(SETTINGS_PATH));
    const parsed = AppSettingsSchema.parse({ ...DEFAULT_APP_SETTINGS, ...raw });
    setDiskLoggingEnabled(parsed.writeDiskLogs);
    return parsed;
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const valid = AppSettingsSchema.parse(next);
  await storage.ensureDir("config");
  await storage.writeTextFile(SETTINGS_PATH, JSON.stringify(valid, null, 2));
  setDiskLoggingEnabled(valid.writeDiskLogs);
  return valid;
}
