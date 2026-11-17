import type { Connection } from "tedious";
import type { BridgeResult } from "@/lib/bridge/postgres";
import type { AdapterExtractionOutput } from "@/lib/adapters/types";
import type { ConnectionConfig, ExtractionOptions } from "@/lib/schemas";
import { resolveExtractionOptions } from "@/lib/schemas";
import { tryNativeCliDump } from "@/lib/bridge/native-cli";
import { closeMssqlClient, openMssqlClient, toTarget } from "./client";
import { classifyMssqlError } from "./errors";
import { extractMssql, readServerInfo } from "./extract";

/** Connects, identifies the MS SQL Server, and disconnects. */
export async function testMssql(cfg: ConnectionConfig): Promise<BridgeResult<{ serverVersion: string }>> {
  const target = toTarget(cfg);
  let client: Connection | undefined;
  try {
    client = await openMssqlClient(cfg);
  } catch (err) {
    return classifyMssqlError(err, target, "connect");
  }

  try {
    const info = await readServerInfo(client);
    return { ok: true, serverVersion: info.serverVersion };
  } catch (err) {
    return classifyMssqlError(err, target, "query");
  } finally {
    await closeMssqlClient(client);
  }
}

export async function extractFromMssql(
  cfg: ConnectionConfig,
  options: ExtractionOptions,
): Promise<BridgeResult<AdapterExtractionOutput>> {
  const resolved = resolveExtractionOptions(options);
  const nativeExtra: AdapterExtractionOutput["files"] = [];
  const nativeWarnings: string[] = [];
  let extractOpts = resolved;

  if (resolved.mode === "native") {
    const native = await tryNativeCliDump("mssql", cfg);
    if (native.warning) nativeWarnings.push(native.warning);
    if (native.ok) {
      nativeExtra.push(...native.files);
      extractOpts = { ...resolved, includeTableData: false };
    }
  }

  const target = toTarget(cfg);
  let client: Connection | undefined;
  try {
    client = await openMssqlClient(cfg);
  } catch (err) {
    return classifyMssqlError(err, target, "connect");
  }

  try {
    const result = await extractMssql(client, cfg, extractOpts);
    return {
      ok: true,
      files: [...result.files, ...nativeExtra],
      counts: result.counts,
      warnings: [...nativeWarnings, ...result.warnings],
      serverVersion: result.serverVersion,
    };
  } catch (err) {
    return classifyMssqlError(err, target, "query");
  } finally {
    await closeMssqlClient(client);
  }
}
