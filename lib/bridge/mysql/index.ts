import type { Connection } from "mysql2/promise";
import type { BridgeResult } from "@/lib/bridge/postgres";
import type { AdapterExtractionOutput } from "@/lib/adapters/types";
import type { ConnectionConfig, ExtractionOptions } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { tryNativeCliDump } from "@/lib/bridge/native-cli";
import { closeMysqlClient, openMysqlClient, toTarget } from "./client";
import { classifyMysqlError } from "./errors";
import { extractMysql, readServerInfo } from "./extract";

/** Connects, identifies the MySQL / MariaDB server, and disconnects. */
export async function testMysql(cfg: ConnectionConfig): Promise<BridgeResult<{ serverVersion: string }>> {
  const target = toTarget(cfg);
  let client: Connection | undefined;
  try {
    client = await openMysqlClient(cfg);
  } catch (err) {
    return classifyMysqlError(err, target, "connect");
  }

  try {
    const info = await readServerInfo(client);
    return { ok: true, serverVersion: info.serverVersion };
  } catch (err) {
    return classifyMysqlError(err, target, "query");
  } finally {
    await closeMysqlClient(client);
  }
}

export async function extractFromMysql(
  cfg: ConnectionConfig,
  options: ExtractionOptions,
): Promise<BridgeResult<AdapterExtractionOutput>> {
  const resolved = resolveExtractionOptions(options);
  const engine = cfg.engine === "mariadb" ? "mariadb" : "mysql";
  const nativeExtra: AdapterExtractionOutput["files"] = [];
  const nativeWarnings: string[] = [];
  let extractOpts = resolved;

  if (resolved.mode === "native") {
    const native = await tryNativeCliDump(engine, cfg);
    if (native.warning) nativeWarnings.push(native.warning);
    if (native.ok) {
      nativeExtra.push(...native.files);
      extractOpts = { ...resolved, includeTableData: false };
      if (native.tool) nativeWarnings.push(`Native backup created with ${native.tool}.`);
    }
  }

  const target = toTarget(cfg);
  let client: Connection | undefined;
  try {
    client = await openMysqlClient(cfg);
  } catch (err) {
    return classifyMysqlError(err, target, "connect");
  }

  try {
    const result = await extractMysql(client, cfg, extractOpts);
    return {
      ok: true,
      files: [...result.files, ...nativeExtra],
      counts: result.counts,
      warnings: [...nativeWarnings, ...result.warnings],
      serverVersion: result.serverVersion,
    };
  } catch (err) {
    return classifyMysqlError(err, target, "query");
  } finally {
    await closeMysqlClient(client);
  }
}
