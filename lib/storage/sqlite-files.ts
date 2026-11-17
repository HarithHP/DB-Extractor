import { del, get, set } from "idb-keyval";
import type { PickedSqliteFile } from "./fs-access";

const HANDLE_PREFIX = "hhp.sqlite.handle:";
const BYTES_PREFIX = "hhp.sqlite.bytes:";
const NAME_PREFIX = "hhp.sqlite.name:";

export async function saveSqliteFile(projectId: string, picked: PickedSqliteFile): Promise<void> {
  await set(NAME_PREFIX + projectId, picked.name);
  if (picked.handle) {
    await set(HANDLE_PREFIX + projectId, picked.handle);
    await del(BYTES_PREFIX + projectId);
  } else if (picked.bytes) {
    await set(BYTES_PREFIX + projectId, picked.bytes);
    await del(HANDLE_PREFIX + projectId);
  }
}

export async function deleteSqliteFile(projectId: string): Promise<void> {
  await Promise.all([
    del(NAME_PREFIX + projectId),
    del(HANDLE_PREFIX + projectId),
    del(BYTES_PREFIX + projectId),
  ]);
}

export async function getSqliteFileName(projectId: string): Promise<string | null> {
  return (await get<string>(NAME_PREFIX + projectId)) ?? null;
}

type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (desc: { mode: "read" }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission?: (desc: { mode: "read" }) => Promise<"granted" | "denied" | "prompt">;
};

export async function readSqliteBytes(projectId: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await get<Uint8Array<ArrayBuffer>>(BYTES_PREFIX + projectId);
  if (bytes) return bytes;

  const handle = await get<PermissionedFileHandle>(HANDLE_PREFIX + projectId);
  if (!handle) {
    throw new Error("No SQLite file is attached to this project. Edit the project and pick a .db file.");
  }
  if (handle.queryPermission && (await handle.queryPermission({ mode: "read" })) !== "granted") {
    const granted = handle.requestPermission && (await handle.requestPermission({ mode: "read" })) === "granted";
    if (!granted) throw new Error("Read permission for the SQLite file was denied");
  }
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}
