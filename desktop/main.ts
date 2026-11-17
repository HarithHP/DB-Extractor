import path from "node:path";
import { BrowserWindow, app, dialog, nativeImage } from "electron";
import { APP_NAME, APP_URL } from "./constants";
import { registerFsIpc } from "./fs-ipc";
import { enableStartWithWindows, launchedHidden } from "./login";
import { ensureServer, stopServer } from "./server";
import { createTray, destroyTray } from "./tray";

let mainWindow: BrowserWindow | undefined;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

function windowIcon(): Electron.NativeImage | undefined {
  const iconFile = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "build", "icon.png");
  const image = nativeImage.createFromPath(iconFile);
  return image.isEmpty() ? undefined : image;
}

function preloadPath(): string {
  return path.join(__dirname, "preload.js");
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    icon: windowIcon(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
  });

  void win.loadURL(APP_URL);
  return win;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function quitApp(): Promise<void> {
  quitting = true;
  destroyTray();
  await stopServer();
  app.quit();
}

async function boot(): Promise<void> {
  enableStartWithWindows();
  registerFsIpc();

  try {
    await ensureServer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(APP_NAME, `Could not start the local server.\n\n${message}`);
    await quitApp();
    return;
  }

  createTray({
    onOpen: () => showMainWindow(),
    onQuit: () => {
      void quitApp();
    },
  });

  mainWindow = createMainWindow();
  if (!launchedHidden()) {
    mainWindow.once("ready-to-show", () => mainWindow?.show());
  }
}

if (gotLock) {
  app.whenReady().then(() => {
    void boot();
  });

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("window-all-closed", () => {
    // Stay alive in the tray; Quit is explicit from the tray menu.
  });
}
