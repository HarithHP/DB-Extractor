import mysql, { type Connection, type ConnectionOptions } from "mysql2/promise";
import type { ConnectionConfig } from "@/lib/schemas";
import type { MysqlTarget } from "./errors";

export const CONNECT_TIMEOUT_MS = 10_000;

export function toTarget(cfg: ConnectionConfig): MysqlTarget {
  return {
    host: cfg.host?.trim() || "127.0.0.1",
    port: cfg.port ?? 3306,
    database: cfg.database?.trim() || "",
    username: cfg.username?.trim(),
    password: cfg.password,
    ssl: cfg.ssl,
  };
}

function sslOption(mode: string | undefined): ConnectionOptions["ssl"] {
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-full") return { rejectUnauthorized: true };
  return undefined;
}

/** Opens a read-only MySQL/MariaDB session. Caller must close it. */
export async function openMysqlClient(cfg: ConnectionConfig): Promise<Connection> {
  const t = toTarget(cfg);
  const options: ConnectionOptions = {
    host: t.host,
    port: t.port,
    database: t.database || undefined,
    user: t.username,
    password: t.password,
    ssl: sslOption(cfg.ssl),
    connectTimeout: CONNECT_TIMEOUT_MS,
    enableKeepAlive: true,
    multipleStatements: false,
    dateStrings: true,
  };

  const connection = await mysql.createConnection(options);

  // Attempt to set read-only session if supported (MySQL 5.6.5+)
  try {
    await connection.query("SET SESSION TRANSACTION READ ONLY");
  } catch {
    // Some older versions or proxies may not support this statement; safe to continue.
  }

  return connection;
}

export async function closeMysqlClient(client: Connection | undefined) {
  if (!client) return;
  try {
    await client.end();
  } catch {
    // Already closed.
  }
}
