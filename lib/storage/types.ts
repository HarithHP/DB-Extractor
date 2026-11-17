export type StorageBackend = "fs-access" | "electron-fs" | "opfs" | "idb" | "memory";

export interface DirEntry {
  name: string;
  kind: "file" | "directory";
}

export type PermissionState = "granted" | "prompt" | "denied" | "no-root";

export interface StorageService {
  readonly backend: StorageBackend;
  ensureDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  /** Optional binary writer (desktop / FS Access). Falls back to base64 `.b64` text when absent. */
  writeBinaryFile?(path: string, data: Uint8Array): Promise<void>;
  readTextFile(path: string): Promise<string>;
  listDir(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  deletePath(path: string): Promise<void>;
  pickRoot(): Promise<void>;
  getRootName(): Promise<string>;
  getPermissionState(): Promise<PermissionState>;
  requestPermission(): Promise<boolean>;
}

export function normalizePath(path: string): string[] {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === "..") throw new Error(`Invalid path segment "${part}" in "${path}"`);
  }
  return parts;
}
