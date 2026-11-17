import {
  checkVerifier,
  createVerifier,
  DEFAULT_ITERATIONS,
  deriveMasterKey,
  generateRawDek,
  generateSalt,
  importDekKeys,
  unwrapDek,
  wrapDek,
  type DekKeys,
} from "@/lib/crypto/kdf";
import { seal } from "@/lib/crypto/vault";
import { MetaConfigSchema, StoredUserSchema, type StoredUser } from "@/lib/schemas";
import { logger } from "@/lib/services/log.service";
import { storage } from "@/lib/storage";
import { fromBase64, toBase64 } from "@/lib/utils/encoding";
import { useAuthStore } from "@/stores/auth.store";

const USER_PATH = "config/user.json";
const META_PATH = "config/meta.json";
const PROJECTS_PATH = "vault/projects.enc";
const APP_VERSION = "0.1.0";

export type BootState =
  | { kind: "needs-setup" }
  | { kind: "needs-permission"; rootName: string }
  | { kind: "needs-onboarding"; rootName: string }
  | { kind: "needs-login"; username: string; rootName: string }
  | { kind: "unlocked"; username: string; rootName: string };

export async function inspectBootState(): Promise<BootState> {
  const perm = await storage.getPermissionState();
  if (perm === "no-root") return { kind: "needs-setup" };
  const rootName = await storage.getRootName();
  if (perm !== "granted") return { kind: "needs-permission", rootName };

  if (!(await storage.exists(USER_PATH))) {
    return { kind: "needs-onboarding", rootName };
  }
  const user = await readStoredUser();
  const { dek } = useAuthStore.getState();
  if (dek) return { kind: "unlocked", username: user.username, rootName };
  return { kind: "needs-login", username: user.username, rootName };
}

export async function readStoredUser(): Promise<StoredUser> {
  const raw = JSON.parse(await storage.readTextFile(USER_PATH));
  return StoredUserSchema.parse(raw);
}

export async function createVaultUser(
  username: string,
  password: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<DekKeys> {
  const cleanUser = username.trim();
  if (!cleanUser) throw new Error("Username is required");
  if (password.length < 8) throw new Error("Master password must be at least 8 characters");

  const salt = generateSalt();
  const mk = await deriveMasterKey(password, salt, iterations);
  const verifier = await createVerifier(mk);

  const kid = `dek-${crypto.randomUUID().slice(0, 8)}`;
  const rawDek = generateRawDek();
  const dekEnvelope = await wrapDek(mk, rawDek, kid);
  const dekKeys = await importDekKeys(rawDek, kid);

  const now = new Date().toISOString();
  const stored: StoredUser = {
    version: 1,
    username: cleanUser,
    salt: toBase64(salt),
    iterations,
    verifier,
    dekEnvelope,
    createdAt: now,
  };

  await storage.ensureDir("config");
  await storage.ensureDir("vault");
  await storage.ensureDir("exports");
  await storage.writeTextFile(USER_PATH, JSON.stringify(stored, null, 2));
  await storage.writeTextFile(
    META_PATH,
    JSON.stringify(MetaConfigSchema.parse({ appVersion: APP_VERSION, schemaVersion: 1, createdAt: now }), null, 2),
  );

  const emptyProjects = await seal(dekKeys, { projects: [] });
  await storage.writeTextFile(PROJECTS_PATH, JSON.stringify(emptyProjects, null, 2));

  useAuthStore.getState().setUnlocked(cleanUser, dekKeys);
  logger.info("auth", `Created vault for user "${cleanUser}"`);
  return dekKeys;
}

export async function unlockVault(password: string): Promise<DekKeys> {
  if (!(await storage.requestPermission())) {
    throw new Error("Folder permission is required to unlock the vault");
  }
  const user = await readStoredUser();
  const mk = await deriveMasterKey(password, fromBase64(user.salt), user.iterations);
  const ok = await checkVerifier(mk, user.verifier);
  if (!ok) {
    logger.warn("auth", "Unlock rejected: invalid master password");
    throw new Error("Incorrect master password");
  }
  const dekKeys = await unwrapDek(mk, user.dekEnvelope);
  useAuthStore.getState().setUnlocked(user.username, dekKeys);
  logger.info("auth", `Vault unlocked for "${user.username}"`);
  return dekKeys;
}

export function lockVault() {
  useAuthStore.getState().lock();
  logger.info("auth", "Vault locked");
}

export async function resetVault(): Promise<void> {
  useAuthStore.getState().lock();
  await storage.deletePath("config/user.json");
  await storage.deletePath("vault");
  logger.warn("auth", "Vault reset by user confirmation");
}
