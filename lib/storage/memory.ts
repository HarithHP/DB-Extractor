import { del, entries, get, set } from "idb-keyval";
import { normalizePath, type DirEntry, type StorageService } from "./types";

const FILE_PREFIX = "hhp.fs.file:";
const DIR_PREFIX = "hhp.fs.dir:";
const READY_KEY = "hhp.idbInitialized";

function join(parts: string[]): string {
  return parts.join("/");
}

/**
 * In-memory StorageService used by unit tests.
 */
export function createMemoryStorage(initialName = "Memory (/HHP)"): StorageService & { dump(): Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>([""]);
  let picked = true;

  function addAncestors(parts: string[]) {
    for (let i = 0; i <= parts.length; i++) dirs.add(join(parts.slice(0, i)));
  }

  return {
    backend: "memory",
    dump: () => new Map(files),
    async pickRoot() {
      picked = true;
    },
    async getRootName() {
      return picked ? initialName : "Not selected";
    },
    async getPermissionState() {
      return picked ? "granted" : "no-root";
    },
    async requestPermission() {
      picked = true;
      return true;
    },
    async ensureDir(path) {
      addAncestors(normalizePath(path));
    },
    async writeTextFile(path, content) {
      const parts = normalizePath(path);
      if (parts.length === 0) throw new Error("Empty file path");
      addAncestors(parts.slice(0, -1));
      files.set(join(parts), content);
    },
    async writeBinaryFile(path, data) {
      const parts = normalizePath(path);
      if (parts.length === 0) throw new Error("Empty file path");
      addAncestors(parts.slice(0, -1));
      let binary = "";
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
      files.set(join(parts), binary);
    },
    async readTextFile(path) {
      const key = join(normalizePath(path));
      const v = files.get(key);
      if (v === undefined) throw new Error(`File not found: ${key}`);
      return v;
    },
    async listDir(path) {
      const prefix = join(normalizePath(path));
      const out = new Map<string, DirEntry>();
      const needle = prefix ? `${prefix}/` : "";

      for (const f of files.keys()) {
        if (!f.startsWith(needle)) continue;
        const rest = f.slice(needle.length);
        if (!rest) continue;
        const [first, ...more] = rest.split("/");
        out.set(first, { name: first, kind: more.length > 0 ? "directory" : "file" });
      }
      for (const d of dirs) {
        if (!d || !d.startsWith(needle)) continue;
        const rest = d.slice(needle.length);
        if (!rest) continue;
        const [first] = rest.split("/");
        if (!out.has(first)) out.set(first, { name: first, kind: "directory" });
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async exists(path) {
      const key = join(normalizePath(path));
      return key === "" || files.has(key) || dirs.has(key);
    },
    async deletePath(path) {
      const key = join(normalizePath(path));
      files.delete(key);
      dirs.delete(key);
      const prefix = `${key}/`;
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
      for (const d of [...dirs]) if (d.startsWith(prefix)) dirs.delete(d);
    },
  };
}

/**
 * IndexedDB-backed fallback when neither File System Access API nor OPFS is available.
 */
export const idbStorage: StorageService = {
  backend: "idb",
  async pickRoot() {
    await set(READY_KEY, true);
  },
  async getRootName() {
    return (await get<boolean>(READY_KEY)) ? "Browser storage (IndexedDB)" : "Not initialized";
  },
  async getPermissionState() {
    return (await get<boolean>(READY_KEY)) ? "granted" : "no-root";
  },
  async requestPermission() {
    await set(READY_KEY, true);
    return true;
  },
  async ensureDir(path) {
    const parts = normalizePath(path);
    for (let i = 1; i <= parts.length; i++) {
      await set(DIR_PREFIX + join(parts.slice(0, i)), 1);
    }
  },
  async writeTextFile(path, content) {
    const parts = normalizePath(path);
    if (parts.length === 0) throw new Error("Empty file path");
    await this.ensureDir(join(parts.slice(0, -1)));
    await set(FILE_PREFIX + join(parts), content);
  },
  async writeBinaryFile(path, data) {
    const parts = normalizePath(path);
    if (parts.length === 0) throw new Error("Empty file path");
    await this.ensureDir(join(parts.slice(0, -1)));
    let binary = "";
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]!);
    await set(FILE_PREFIX + join(parts), binary);
  },
  async readTextFile(path) {
    const key = join(normalizePath(path));
    const v = await get<string>(FILE_PREFIX + key);
    if (v === undefined) throw new Error(`File not found: ${key}`);
    return v;
  },
  async listDir(path) {
    const prefix = join(normalizePath(path));
    const needle = prefix ? `${prefix}/` : "";
    const all = await entries<string, unknown>();
    const out = new Map<string, DirEntry>();

    for (const [k] of all) {
      if (typeof k !== "string") continue;
      const isFile = k.startsWith(FILE_PREFIX);
      const isDir = k.startsWith(DIR_PREFIX);
      if (!isFile && !isDir) continue;
      const rel = k.slice(isFile ? FILE_PREFIX.length : DIR_PREFIX.length);
      if (!rel.startsWith(needle)) continue;
      const rest = rel.slice(needle.length);
      if (!rest) continue;
      const [first, ...more] = rest.split("/");
      const kind = more.length > 0 || isDir ? "directory" : "file";
      if (!out.has(first) || kind === "directory") out.set(first, { name: first, kind });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  async exists(path) {
    const key = join(normalizePath(path));
    if (!key) return true;
    return (await get(FILE_PREFIX + key)) !== undefined || (await get(DIR_PREFIX + key)) !== undefined;
  },
  async deletePath(path) {
    const key = join(normalizePath(path));
    const all = await entries<string, unknown>();
    for (const [k] of all) {
      if (typeof k !== "string") continue;
      for (const pfx of [FILE_PREFIX, DIR_PREFIX]) {
        if (k === pfx + key || k.startsWith(`${pfx}${key}/`)) await del(k);
      }
    }
  },
};
