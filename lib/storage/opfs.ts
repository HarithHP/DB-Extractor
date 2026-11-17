import { get, set } from "idb-keyval";
import { createHandleStorage } from "./handle-driver";
import type { StorageService } from "./types";

const OPFS_READY_KEY = "hhp.opfsInitialized";

export function supportsOpfs(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

export const opfsStorage: StorageService = createHandleStorage({
  backend: "opfs",
  async getHandle(create = false) {
    if (!supportsOpfs()) return null;
    if (!create && !(await get<boolean>(OPFS_READY_KEY))) return null;
    const root = await navigator.storage.getDirectory();
    const hhp = await root.getDirectoryHandle("HHP", { create: true });
    if (create) await set(OPFS_READY_KEY, true);
    return hhp;
  },
  async pickRoot() {
    const root = await navigator.storage.getDirectory();
    const hhp = await root.getDirectoryHandle("HHP", { create: true });
    await set(OPFS_READY_KEY, true);
    return hhp;
  },
  rootName(handle) {
    return handle ? "Browser storage (OPFS /HHP)" : "Not initialized";
  },
});
