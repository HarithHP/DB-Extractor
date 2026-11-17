import { get, set } from "idb-keyval";
import { electronFsStorage, isElectronDesktop } from "./electron-fs";
import { fsAccessStorage, supportsDirectoryPicker } from "./fs-access";
import { createMemoryStorage, idbStorage } from "./memory";
import { opfsStorage, supportsOpfs } from "./opfs";
import type { StorageBackend, StorageService } from "./types";

export * from "./types";
export {
  createMemoryStorage,
  electronFsStorage,
  fsAccessStorage,
  idbStorage,
  isElectronDesktop,
  opfsStorage,
  supportsDirectoryPicker,
  supportsOpfs,
};
export { pickSqliteFile, supportsOpenFilePicker, type PickedSqliteFile } from "./fs-access";
export * from "./sqlite-files";

const BACKEND_PREF_KEY = "hhp.storageBackend";

let override: StorageService | null = null;
let cachedBackend: StorageBackend | null = null;

/** Used by tests to inject an in-memory StorageService. */
export function setStorageOverride(service: StorageService | null) {
  override = service;
  cachedBackend = service?.backend ?? null;
}

export async function selectStorageBackend(
  backend: "fs-access" | "electron-fs" | "opfs" | "idb",
): Promise<StorageService> {
  // Desktop shell always uses the Node filesystem bridge.
  if (isElectronDesktop()) {
    cachedBackend = "electron-fs";
    await set(BACKEND_PREF_KEY, "electron-fs");
    return electronFsStorage;
  }
  cachedBackend = backend;
  await set(BACKEND_PREF_KEY, backend);
  return getByBackend(backend);
}

function getByBackend(backend: StorageBackend): StorageService {
  switch (backend) {
    case "electron-fs":
      return electronFsStorage;
    case "fs-access":
      return fsAccessStorage;
    case "opfs":
      return opfsStorage;
    case "idb":
      return idbStorage;
    case "memory":
      return override ?? createMemoryStorage();
  }
}

export async function resolveStorage(): Promise<StorageService> {
  if (override) return override;
  if (typeof window === "undefined") {
    override = createMemoryStorage();
    return override;
  }
  if (isElectronDesktop()) {
    cachedBackend = "electron-fs";
    return electronFsStorage;
  }
  if (!cachedBackend) {
    const saved = await get<StorageBackend>(BACKEND_PREF_KEY);
    if (saved === "fs-access" && supportsDirectoryPicker()) cachedBackend = "fs-access";
    else if (saved === "opfs" && supportsOpfs()) cachedBackend = "opfs";
    else if (saved === "idb") cachedBackend = "idb";
    else if (supportsDirectoryPicker()) cachedBackend = "fs-access";
    else if (supportsOpfs()) cachedBackend = "opfs";
    else cachedBackend = "idb";
  }
  return getByBackend(cachedBackend);
}

/**
 * Facade that delegates every call to the active StorageService.
 */
export const storage: StorageService = {
  get backend() {
    if (override) return override.backend;
    if (isElectronDesktop()) return "electron-fs";
    return cachedBackend ?? "fs-access";
  },
  ensureDir: async (p) => (await resolveStorage()).ensureDir(p),
  writeTextFile: async (p, c) => (await resolveStorage()).writeTextFile(p, c),
  writeBinaryFile: async (p, data) => {
    const svc = await resolveStorage();
    if (svc.writeBinaryFile) return svc.writeBinaryFile(p, data);
    let binary = "";
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
    await svc.writeTextFile(`${p}.b64`, btoa(binary));
  },
  readTextFile: async (p) => (await resolveStorage()).readTextFile(p),
  listDir: async (p) => (await resolveStorage()).listDir(p),
  exists: async (p) => (await resolveStorage()).exists(p),
  deletePath: async (p) => (await resolveStorage()).deletePath(p),
  pickRoot: async () => (await resolveStorage()).pickRoot(),
  getRootName: async () => (await resolveStorage()).getRootName(),
  getPermissionState: async () => (await resolveStorage()).getPermissionState(),
  requestPermission: async () => (await resolveStorage()).requestPermission(),
};
