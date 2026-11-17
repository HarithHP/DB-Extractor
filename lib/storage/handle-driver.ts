import { normalizePath, type DirEntry, type StorageBackend, type StorageService } from "./types";

type PermissionedHandle = FileSystemDirectoryHandle & {
  queryPermission?: (desc: { mode: "read" | "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission?: (desc: { mode: "read" | "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  values?: () => AsyncIterableIterator<FileSystemHandle>;
};

export interface HandleProvider {
  readonly backend: StorageBackend;
  getHandle(create?: boolean): Promise<PermissionedHandle | null>;
  pickRoot(): Promise<PermissionedHandle>;
  rootName(handle: PermissionedHandle | null): string;
}

export function createHandleStorage(provider: HandleProvider): StorageService {
  async function requireRoot(): Promise<PermissionedHandle> {
    const h = await provider.getHandle(true);
    if (!h) throw new Error("No storage folder has been selected yet");
    if (h.queryPermission) {
      const state = await h.queryPermission({ mode: "readwrite" });
      if (state !== "granted") {
        const next = h.requestPermission ? await h.requestPermission({ mode: "readwrite" }) : "denied";
        if (next !== "granted") throw new Error("Folder permission was denied");
      }
    }
    return h;
  }

  async function walkDir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir: FileSystemDirectoryHandle = await requireRoot();
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }

  return {
    backend: provider.backend,

    async pickRoot() {
      await provider.pickRoot();
    },

    async getRootName() {
      return provider.rootName(await provider.getHandle(false));
    },

    async getPermissionState() {
      const h = await provider.getHandle(false);
      if (!h) return "no-root";
      if (!h.queryPermission) return "granted";
      return h.queryPermission({ mode: "readwrite" });
    },

    async requestPermission() {
      const h = await provider.getHandle(true);
      if (!h) return false;
      if (!h.queryPermission) return true;
      if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
      return h.requestPermission ? (await h.requestPermission({ mode: "readwrite" })) === "granted" : false;
    },

    async ensureDir(path) {
      await walkDir(normalizePath(path), true);
    },

    async writeTextFile(path, content) {
      const parts = normalizePath(path);
      const name = parts.pop();
      if (!name) throw new Error(`Cannot write to an empty path: "${path}"`);
      const dir = await walkDir(parts, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
    },

    async writeBinaryFile(path, data) {
      const parts = normalizePath(path);
      const name = parts.pop();
      if (!name) throw new Error(`Cannot write to an empty path: "${path}"`);
      const dir = await walkDir(parts, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      await writable.write(copy);
      await writable.close();
    },

    async readTextFile(path) {
      const parts = normalizePath(path);
      const name = parts.pop();
      if (!name) throw new Error(`Cannot read an empty path: "${path}"`);
      const dir = await walkDir(parts, false);
      const fh = await dir.getFileHandle(name);
      return (await fh.getFile()).text();
    },

    async listDir(path) {
      let dir: PermissionedHandle;
      try {
        dir = (await walkDir(normalizePath(path), false)) as PermissionedHandle;
      } catch {
        return [];
      }
      const out: DirEntry[] = [];
      if (dir.values) {
        for await (const handle of dir.values()) {
          out.push({ name: handle.name, kind: handle.kind });
        }
      } else if (dir.entries) {
        for await (const [name, handle] of dir.entries()) {
          out.push({ name, kind: handle.kind });
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    async exists(path) {
      const parts = normalizePath(path);
      if (parts.length === 0) return true;
      const name = parts.pop()!;
      try {
        const dir = await walkDir(parts, false);
        try {
          await dir.getFileHandle(name);
          return true;
        } catch {
          await dir.getDirectoryHandle(name);
          return true;
        }
      } catch {
        return false;
      }
    },

    async deletePath(path) {
      const parts = normalizePath(path);
      const name = parts.pop();
      if (!name) return;
      try {
        const dir = await walkDir(parts, false);
        await dir.removeEntry(name, { recursive: true });
      } catch {
        // Ignore deleting a non-existent entry.
      }
    },
  };
}
