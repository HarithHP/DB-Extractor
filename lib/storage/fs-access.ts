import { get, set } from "idb-keyval";
import { createHandleStorage } from "./handle-driver";
import type { StorageService } from "./types";

const ROOT_HANDLE_KEY = "hhp.rootHandle";

type WindowWithPicker = Window & {
  showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (opts?: {
    id?: string;
    multiple?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithPicker).showDirectoryPicker === "function";
}

export function supportsOpenFilePicker(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithPicker).showOpenFilePicker === "function";
}

export const fsAccessStorage: StorageService = createHandleStorage({
  backend: "fs-access",
  async getHandle() {
    return (await get<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY)) ?? null;
  },
  async pickRoot() {
    const picker = (window as WindowWithPicker).showDirectoryPicker;
    if (!picker) throw new Error("This browser does not support picking a local folder");
    const handle = await picker({ id: "hhp-root", mode: "readwrite" });
    await set(ROOT_HANDLE_KEY, handle);
    return handle;
  },
  rootName(handle) {
    return handle?.name ?? "Not selected";
  },
});

export interface PickedSqliteFile {
  name: string;
  handle?: FileSystemFileHandle;
  bytes?: Uint8Array<ArrayBuffer>;
}

/**
 * Picks a SQLite .db file. Uses showOpenFilePicker when available (so the handle
 * can be persisted across sessions) and falls back to <input type="file"> on mobile/Firefox.
 */
export async function pickSqliteFile(): Promise<PickedSqliteFile> {
  if (supportsOpenFilePicker()) {
    const [handle] = await (window as WindowWithPicker).showOpenFilePicker!({
      id: "hhp-sqlite",
      multiple: false,
      types: [
        {
          description: "SQLite database",
          accept: { "application/vnd.sqlite3": [".db", ".sqlite", ".sqlite3"] },
        },
      ],
    });
    return { name: handle.name, handle };
  }

  return new Promise<PickedSqliteFile>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".db,.sqlite,.sqlite3,application/vnd.sqlite3";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    input.click();
  });
}
