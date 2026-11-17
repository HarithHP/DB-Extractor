import { contextBridge, ipcRenderer } from "electron";

const api = {
  isElectron: true as const,
  fs: {
    getRoot: (): Promise<string | null> => ipcRenderer.invoke("hhp:fs:getRoot"),
    pickRoot: (): Promise<string> => ipcRenderer.invoke("hhp:fs:pickRoot"),
    ensureDir: (path: string): Promise<void> => ipcRenderer.invoke("hhp:fs:ensureDir", path),
    writeTextFile: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke("hhp:fs:writeTextFile", path, content),
    writeBinaryFile: (path: string, base64: string): Promise<void> =>
      ipcRenderer.invoke("hhp:fs:writeBinaryFile", path, base64),
    readTextFile: (path: string): Promise<string> => ipcRenderer.invoke("hhp:fs:readTextFile", path),
    listDir: (path: string): Promise<Array<{ name: string; kind: "file" | "directory" }>> =>
      ipcRenderer.invoke("hhp:fs:listDir", path),
    exists: (path: string): Promise<boolean> => ipcRenderer.invoke("hhp:fs:exists", path),
    deletePath: (path: string): Promise<void> => ipcRenderer.invoke("hhp:fs:deletePath", path),
  },
};

contextBridge.exposeInMainWorld("hhpDesktop", api);

export type HhpDesktopApi = typeof api;
