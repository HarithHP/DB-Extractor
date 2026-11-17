import { Client, type ClientConfig } from "pg";
import type { ConnectionConfig } from "@/lib/schemas";
import type { PgTarget } from "./errors";

export const CONNECT_TIMEOUT_MS = 10_000;
export const STATEMENT_TIMEOUT_MS = 60_000;

export function toTarget(cfg: ConnectionConfig): PgTarget {
  return {
    host: cfg.host?.trim() || "127.0.0.1",
    port: cfg.port ?? 5432,
    database: cfg.database,
    username: cfg.username,
    password: cfg.password,
    ssl: cfg.ssl,
  };
}

function sslOption(mode: string | undefined, host: string): ClientConfig["ssl"] {
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-full") return { rejectUnauthorized: true, servername: host };
  return false;
}

/** Opens a read-only session. Caller must `end()` it. */
export async function openPgClient(cfg: ConnectionConfig): Promise<Client> {
  const t = toTarget(cfg);
  const client = new Client({
    host: t.host,
    port: t.port,
    database: t.database,
    user: t.username,
    password: t.password,
    ssl: sslOption(cfg.ssl, t.host),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
    application_name: "hhp-db-extractor",
  });
  // Socket errors after connect would otherwise crash the Node process.
  client.on("error", () => {});
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
  } catch (err) {
    await closePgClient(client);
    throw err;
  }
  return client;
}

export async function closePgClient(client: Client | undefined) {
  if (!client) return;
  try {
    await client.end();
  } catch {
    // Already closed.
  }
}
