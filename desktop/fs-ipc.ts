import { promises as fs } from "node:fs";
import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { APP_NAME } from "./constants";

const CHANNELS = {
  getRoot: "hhp:fs:getRoot",
  pickRoot: "hhp:fs:pickRoot",
  ensureDir: "hhp:fs:ensureDir",
  writeTextFile: "hhp:fs:writeTextFile",
  writeBinaryFile: "hhp:fs:writeBinaryFile",
  readTextFile: "hhp:fs:readTextFile",
  listDir: "hhp:fs:listDir",
  exists: "hhp:fs:exists",
  deletePath: "hhp:fs:deletePath",
} as const;

function rootConfigPath(): string {
  return path.join(app.getPath("userData"), "storage-root.json");
}

async function loadRoot(): Promise<string | null> {
  try {
    const raw = await fs.readFile(rootConfigPath(), "utf8");
    const data = JSON.parse(raw) as { root?: unknown };
    if (typeof data.root !== "string" || !path.isAbsolute(data.root)) return null;
    return path.resolve(data.root);
  } catch {
    return null;
  }
}

async function saveRoot(root: string): Promise<void> {
  await fs.writeFile(rootConfigPath(), JSON.stringify({ root: path.resolve(root) }, null, 2), "utf8");
}

function normalizeRel(rel: string): string[] {
  const parts = rel.replaceAll("\\", "/").split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === "..") throw new Error(`Invalid path segment "${part}" in "${rel}"`);
  }
  return parts;
}

function resolveUnderRoot(root: string, rel: string): string {
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, ...normalizeRel(rel));
  const rootCmp = rootResolved.toLowerCase();
  const fullCmp = full.toLowerCase();
  if (fullCmp !== rootCmp && !fullCmp.startsWith(rootCmp + path.sep.toLowerCase())) {
    throw new Error("Path escapes storage root");
  }
  return full;
}

async function requireRoot(): Promise<string> {
  const root = await loadRoot();
  if (!root) throw new Error("No storage folder has been selected yet");
  return root;
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerFsIpc(): void {
  ipcMain.handle(CHANNELS.getRoot, async () => loadRoot());

  ipcMain.handle(CHANNELS.pickRoot, async (event) => {
    const win = senderWindow(event);
    const current = await loadRoot();
    const opts: Electron.OpenDialogOptions = {
      title: `${APP_NAME} — choose storage folder`,
      defaultPath: current ?? (process.platform === "win32" ? "C:\\HHP" : app.getPath("home")),
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) {
      const err = new Error("No folder selected");
      err.name = "AbortError";
      throw err;
    }
    const root = path.resolve(result.filePaths[0]);
    await fs.mkdir(root, { recursive: true });
    await saveRoot(root);
    return root;
  });

  ipcMain.handle(CHANNELS.ensureDir, async (_e, rel: string) => {
    const root = await requireRoot();
    await fs.mkdir(resolveUnderRoot(root, rel), { recursive: true });
  });

  ipcMain.handle(CHANNELS.writeTextFile, async (_e, rel: string, content: string) => {
    const root = await requireRoot();
    const full = resolveUnderRoot(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  });

  ipcMain.handle(CHANNELS.writeBinaryFile, async (_e, rel: string, base64: string) => {
    const root = await requireRoot();
    const full = resolveUnderRoot(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, Buffer.from(base64, "base64"));
  });

  ipcMain.handle(CHANNELS.readTextFile, async (_e, rel: string) => {
    const root = await requireRoot();
    return fs.readFile(resolveUnderRoot(root, rel), "utf8");
  });

  ipcMain.handle(CHANNELS.listDir, async (_e, rel: string) => {
    const root = await requireRoot();
    const full = resolveUnderRoot(root, rel);
    try {
      const entries = await fs.readdir(full, { withFileTypes: true });
      return entries
        .map((e) => ({
          name: e.name,
          kind: e.isDirectory() ? ("directory" as const) : ("file" as const),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw err;
    }
  });

  ipcMain.handle(CHANNELS.exists, async (_e, rel: string) => {
    const root = await requireRoot();
    try {
      await fs.access(resolveUnderRoot(root, rel));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(CHANNELS.deletePath, async (_e, rel: string) => {
    const root = await requireRoot();
    const full = resolveUnderRoot(root, rel);
    await fs.rm(full, { recursive: true, force: true });
  });
}

export const FS_IPC_CHANNELS = CHANNELS;
