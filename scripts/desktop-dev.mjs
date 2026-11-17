/**
 * Starts Next.js on 127.0.0.1:9000, compiles the Electron main process, then launches Electron.
 * Ctrl+C stops both.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const npxCmd = isWin ? "npx.cmd" : "npx";

const children = [];

function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    ...opts,
  });
  children.push(child);
  return child;
}

function waitForUrl(url, timeoutMs = 120_000) {
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
        setTimeout(tick, 400);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run(npmCmd, ["run", "dev"]);

try {
  await waitForUrl("http://127.0.0.1:9000");
} catch (err) {
  console.error(err);
  shutdown();
}

const compile = run(npxCmd, ["tsc", "-p", "tsconfig.desktop.json"]);
await new Promise((resolve, reject) => {
  compile.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tsc exited ${code}`))));
});

const electron = run(npxCmd, ["electron", "."]);
electron.on("exit", shutdown);
