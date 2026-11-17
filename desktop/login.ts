import { app } from "electron";

/** Always register as a Windows startup app; launch hidden to tray at login. */
export function enableStartWithWindows(): void {
  if (process.platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
    path: process.execPath,
    args: ["--hidden"],
  });
}

export function launchedHidden(): boolean {
  if (app.getLoginItemSettings().wasOpenedAsHidden) return true;
  return process.argv.includes("--hidden");
}
