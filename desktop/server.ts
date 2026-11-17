import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { app } from "electron";
import { APP_URL, HOST, PORT, READY_POLL_MS, READY_TIMEOUT_MS } from "./constants";

let child: ChildProcess | undefined;

function standaloneRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "standalone");
  }
  return path.join(app.getAppPath(), ".next", "standalone");
}

function serverEntry(): string {
  return path.join(standaloneRoot(), "server.js");
}

function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, READY_POLL_MS);
      });
      req.setTimeout(2_000, () => {
        req.destroy();
      });
    };
    tick();
  });
}

/** True when a server is already listening (e.g. `next dev` during desktop:dev). */
export function isServerReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(APP_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1_500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Ensures the Next.js app is reachable on 127.0.0.1:9000.
 * In packaged / production desktop builds, spawns the standalone server.
 * In desktop:dev, reuses an already-running `next dev` if present.
 */
export async function ensureServer(): Promise<void> {
  if (await isServerReachable()) return;

  const entry = serverEntry();
  if (!existsSync(entry)) {
    throw new Error(
      `Next standalone server not found at ${entry}. Run \`npm run desktop:build\` (or \`next build\` + prepare-standalone) first.`,
    );
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(PORT),
    HOSTNAME: HOST,
    // Prefer IPv4 loopback; avoid Windows HOSTNAME computer-name confusion for Next.
    HOST: HOST,
  };

  child = spawn(process.execPath, [entry], {
    cwd: standaloneRoot(),
    env,
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true,
  });

  child.on("exit", (code, signal) => {
    if (!app.isPackaged) {
      console.error(`[desktop] Next server exited code=${code} signal=${signal}`);
    }
    child = undefined;
  });

  await waitForReady(APP_URL, READY_TIMEOUT_MS);
}

export async function stopServer(): Promise<void> {
  const proc = child;
  child = undefined;
  if (!proc || proc.killed) return;

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    proc.once("exit", done);
    proc.kill();
    setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      done();
    }, 3_000);
  });
}
