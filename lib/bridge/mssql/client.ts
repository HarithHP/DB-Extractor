import { Connection, Request, type ConnectionConfiguration as TediousConfig } from "tedious";
import type { ConnectionConfig } from "@/lib/schemas";
import type { MssqlTarget } from "./errors";

export const CONNECT_TIMEOUT_MS = 10_000;
export const STATEMENT_TIMEOUT_MS = 60_000;

export function toTarget(cfg: ConnectionConfig): MssqlTarget {
  return {
    host: cfg.host?.trim() || "127.0.0.1",
    port: cfg.port ?? 1433,
    database: cfg.database?.trim() || "",
    username: cfg.username?.trim(),
    password: cfg.password,
    ssl: cfg.ssl,
  };
}

/** Opens a TDS connection to MS SQL Server. Caller must close it. */
export function openMssqlClient(cfg: ConnectionConfig): Promise<Connection> {
  const t = toTarget(cfg);
  const isVerifyFull = cfg.ssl === "verify-full";
  const isEncrypted = cfg.ssl === "require" || cfg.ssl === "verify-full" || cfg.ssl === undefined;

  const tediousConfig: TediousConfig = {
    server: t.host,
    authentication: {
      type: "default",
      options: {
        userName: t.username || "",
        password: t.password || "",
      },
    },
    options: {
      port: t.port,
      database: t.database || undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: STATEMENT_TIMEOUT_MS,
      encrypt: isEncrypted,
      trustServerCertificate: !isVerifyFull,
      rowCollectionOnRequestCompletion: true,
      useColumnNames: true,
      appName: "hhp-db-extractor",
    },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let conn: Connection;
    try {
      conn = new Connection(tediousConfig);
    } catch (err) {
      return reject(err);
    }

    conn.on("connect", (err) => {
      if (settled) return;
      settled = true;
      if (err) {
        conn.close();
        reject(err);
      } else {
        resolve(conn);
      }
    });

    conn.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    conn.connect();
  });
}

export function executeMssqlQuery<T = Record<string, unknown>>(
  conn: Connection,
  sql: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = [];
    const request = new Request(sql, (err) => {
      if (err) return reject(err);
      resolve(rows);
    });

    request.on("row", (columns) => {
      // With useColumnNames: true, tedious emits a name→column map; otherwise an array.
      const list = Array.isArray(columns) ? columns : Object.values(columns);
      const row: Record<string, unknown> = {};
      for (const col of list as Array<{ value: unknown; metadata: { colName: string } }>) {
        row[col.metadata.colName] = col.value;
      }
      rows.push(row as T);
    });

    conn.execSql(request);
  });
}

export async function closeMssqlClient(client: Connection | undefined) {
  if (!client) return;
  try {
    client.close();
  } catch {
    // Already closed.
  }
}
