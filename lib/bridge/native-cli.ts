import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { ConnectionConfig, EngineId } from "@/lib/schemas";
import type { SqlFile } from "@/lib/adapters/types";

async function commandExists(cmd: string): Promise<boolean> {
  const isWin = process.platform === "win32";
  const checker = isWin ? "where" : "which";
  return new Promise((resolve) => {
    const child = spawn(checker, [cmd], { windowsHide: true, stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function runCapture(
  cmd: string,
  args: string[],
  envExtra: Record<string, string>,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...envExtra },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message }));
    child.on("exit", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}

export interface NativeDumpResult {
  ok: boolean;
  files: SqlFile[];
  tool?: string;
  warning?: string;
}

/** Attempt engine-native logical dumps via CLI tools on PATH. */
export async function tryNativeCliDump(
  engine: EngineId,
  cfg: ConnectionConfig,
): Promise<NativeDumpResult> {
  if (engine === "postgres") {
    if (!(await commandExists("pg_dump"))) {
      return { ok: false, files: [], warning: "pg_dump was not found on PATH; using portable SQL data dump instead." };
    }
    const host = cfg.host?.trim() || "127.0.0.1";
    const port = String(cfg.port ?? 5432);
    const result = await runCapture(
      "pg_dump",
      [
        "--format=plain",
        "--no-owner",
        "--no-privileges",
        "--host",
        host,
        "--port",
        port,
        "--username",
        cfg.username || "postgres",
        "--dbname",
        cfg.database,
      ],
      { PGPASSWORD: cfg.password || "" },
    );
    if (!result.ok) {
      return {
        ok: false,
        files: [],
        warning: `pg_dump failed: ${result.stderr.trim() || "unknown error"}; using portable SQL data dump instead.`,
      };
    }
    return {
      ok: true,
      tool: "pg_dump",
      files: [
        {
          filename: "native/database.sql",
          category: "table_data",
          content: result.stdout,
          sha256: "",
        },
      ],
    };
  }

  if (engine === "mysql" || engine === "mariadb") {
    if (!(await commandExists("mysqldump"))) {
      return { ok: false, files: [], warning: "mysqldump was not found on PATH; using portable SQL data dump instead." };
    }
    const host = cfg.host?.trim() || "127.0.0.1";
    const port = String(cfg.port ?? 3306);
    const args = [
      `--host=${host}`,
      `--port=${port}`,
      `--user=${cfg.username || "root"}`,
      "--single-transaction",
      "--routines",
      "--triggers",
      cfg.database,
    ];
    const result = await runCapture("mysqldump", args, { MYSQL_PWD: cfg.password || "" });
    if (!result.ok) {
      return {
        ok: false,
        files: [],
        warning: `mysqldump failed: ${result.stderr.trim() || "unknown error"}; using portable SQL data dump instead.`,
      };
    }
    return {
      ok: true,
      tool: "mysqldump",
      files: [
        {
          filename: "native/database.sql",
          category: "table_data",
          content: result.stdout,
          sha256: "",
        },
      ],
    };
  }

  if (engine === "mssql") {
    return {
      ok: false,
      files: [],
      warning:
        "SQL Server native .bak files are written on the database server and usually cannot be downloaded from shared hosts; using portable SQL data dump instead.",
    };
  }

  return { ok: false, files: [], warning: `Native dump is not available for engine "${engine}".` };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
