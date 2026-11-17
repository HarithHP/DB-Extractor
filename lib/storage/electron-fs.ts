import type { DirEntry, StorageService } from "./types";

export interface HhpDesktopFsApi {
  getRoot: () => Promise<string | null>;
  pickRoot: () => Promise<string>;
  ensureDir: (path: string) => Promise<void>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  writeBinaryFile: (path: string, base64: string) => Promise<void>;
  readTextFile: (path: string) => Promise<string>;
  listDir: (path: string) => Promise<DirEntry[]>;
  exists: (path: string) => Promise<boolean>;
  deletePath: (path: string) => Promise<void>;
}

export interface HhpDesktopApi {
  isElectron: true;
  fs: HhpDesktopFsApi;
}

declare global {
  interface Window {
    hhpDesktop?: HhpDesktopApi;
  }
}

export function isElectronDesktop(): boolean {
  return typeof window !== "undefined" && window.hhpDesktop?.isElectron === true;
}

function bridge(): HhpDesktopFsApi {
  const api = typeof window !== "undefined" ? window.hhpDesktop?.fs : undefined;
  if (!api) throw new Error("Electron filesystem bridge is not available");
  return api;
}

/** Node.js filesystem via Electron IPC — no File System Access permission prompts. */
export const electronFsStorage: StorageService = {
  backend: "electron-fs",

  async pickRoot() {
    await bridge().pickRoot();
  },

  async getRootName() {
    const root = await bridge().getRoot();
    return root ?? "Not selected";
  },

  async getPermissionState() {
    const root = await bridge().getRoot();
    return root ? "granted" : "no-root";
  },

  async requestPermission() {
    return (await bridge().getRoot()) !== null;
  },

  async ensureDir(path) {
    await bridge().ensureDir(path);
  },

  async writeTextFile(path, content) {
    await bridge().writeTextFile(path, content);
  },

  async writeBinaryFile(path, data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    await bridge().writeBinaryFile(path, btoa(binary));
  },

  async readTextFile(path) {
    return bridge().readTextFile(path);
  },

  async listDir(path) {
    return bridge().listDir(path);
  },

  async exists(path) {
    return bridge().exists(path);
  },

  async deletePath(path) {
    await bridge().deletePath(path);
  },
};
