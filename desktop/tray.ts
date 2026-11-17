import path from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";
import { APP_NAME } from "./constants";

let tray: Tray | undefined;

function iconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(app.getAppPath(), "build", "icon.png");
}

export function createTray(handlers: { onOpen: () => void; onQuit: () => void }): Tray {
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => handlers.onOpen() },
      { type: "separator" },
      { label: "Quit", click: () => handlers.onQuit() },
    ]),
  );
  tray.on("double-click", () => handlers.onOpen());
  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = undefined;
}
