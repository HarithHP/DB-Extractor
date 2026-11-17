import type { Client } from "pg";
import type { BridgeErrorBody } from "@/lib/adapters/diagnostics";
import type { AdapterExtractionOutput } from "@/lib/adapters/types";
import type { ConnectionConfig, ExtractionOptions } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { tryNativeCliDump } from "@/lib/bridge/native-cli";
import { closePgClient, openPgClient, toTarget } from "./client";
import { classifyPgError } from "./errors";
import { extractPostgres, MIN_SERVER_VERSION_NUM, readServerInfo } from "./extract";

export type BridgeResult<T> = ({ ok: true } & T) | BridgeErrorBody;

/** Connects, identifies the server, and disconnects. */
export async function testPostgres(cfg: ConnectionConfig): Promise<BridgeResult<{ serverVersion: string }>> {
  const target = toTarget(cfg);
  let client: Client | undefined;
  try {
    client = await openPgClient(cfg);
  } catch (err) {
    return classifyPgError(err, target, "connect");
  }
  try {
    const info = await readServerInfo(client);
    if (info.versionNum < MIN_SERVER_VERSION_NUM) {
      return {
        ok: false,
        code: "DB_QUERY_FAILED",
        stage: "db_query",
        title: "PostgreSQL version not supported",
        error: `Connected, but ${info.fullVersion} is older than the supported minimum (PostgreSQL 10).`,
        hint: "Upgrade the server, or export the schema with pg_dump --schema-only.",
      };
    }
    return { ok: true, serverVersion: info.serverVersion };
  } catch (err) {
    return classifyPgError(err, target, "query");
  } finally {
    await closePgClient(client);
  }
}

export async function extractFromPostgres(
  cfg: ConnectionConfig,
  options: ExtractionOptions,
): Promise<BridgeResult<AdapterExtractionOutput>> {
  const resolved = resolveExtractionOptions(options);
  const nativeExtra: AdapterExtractionOutput["files"] = [];
  const nativeWarnings: string[] = [];
  let extractOpts = resolved;

  if (resolved.mode === "native") {
    const native = await tryNativeCliDump("postgres", cfg);
    if (native.warning) nativeWarnings.push(native.warning);
    if (native.ok) {
      nativeExtra.push(...native.files);
      extractOpts = { ...resolved, includeTableData: false };
      if (native.tool) nativeWarnings.push(`Native backup created with ${native.tool}.`);
    }
  }

  const target = toTarget(cfg);
  let client: Client | undefined;
  try {
    client = await openPgClient(cfg);
  } catch (err) {
    return classifyPgError(err, target, "connect");
  }
  try {
    const result = await extractPostgres(client, cfg, extractOpts);
    return {
      ok: true,
      files: [...result.files, ...nativeExtra],
      counts: result.counts,
      warnings: [...nativeWarnings, ...result.warnings],
      serverVersion: result.serverVersion,
    };
  } catch (err) {
    return classifyPgError(err, target, "query");
  } finally {
    await closePgClient(client);
  }
}
