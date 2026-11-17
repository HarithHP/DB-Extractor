import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXTRACTION_OPTIONS } from "@/lib/schemas";
import { createVaultUser, lockVault, unlockVault } from "@/lib/services/auth.service";
import { buildSnapshotZip, listSnapshots, runExtraction } from "@/lib/services/extraction.service";
import { clearRegisteredSecrets, logger, registerSecretForRedaction } from "@/lib/services/log.service";
import { createProject, loadConnectionConfig, loadProjects } from "@/lib/services/project.service";
import { createMemoryStorage, setStorageOverride } from "@/lib/storage";
import { useAuthStore } from "@/stores/auth.store";
import { useLogStore } from "@/stores/log.store";
import { useProjectStore } from "@/stores/project.store";
import { buildSampleSqliteBytes } from "./fixtures/sqlite-fixture";

describe("vault + orchestrator + redaction integration", () => {
  let mem = createMemoryStorage();

  beforeEach(() => {
    mem = createMemoryStorage();
    setStorageOverride(mem);
    useAuthStore.getState().lock();
    useProjectStore.getState().reset();
    useLogStore.getState().clear();
    clearRegisteredSecrets();
  });

  it("never writes the master password, connection password, or raw JWT anywhere on disk", async () => {
    const masterPassword = "Master-Secret-Password-99!";
    const dbPassword = "Db-Super-Secret-Password-42!";

    await createVaultUser("alice", masterPassword, 1_000);
    const proj = await createProject({
      name: "Core Postgres",
      engine: "postgres",
      tags: ["prod"],
      notes: "primary",
      connection: {
        host: "db.internal",
        port: 5432,
        database: "core_prod",
        schema: "public",
        username: "app_ro",
        password: dbPassword,
        ssl: "require",
      },
    });

    for (const [path, content] of mem.dump().entries()) {
      expect(content, `leaked master password in ${path}`).not.toContain(masterPassword);
      expect(content, `leaked db password in ${path}`).not.toContain(dbPassword);
      expect(content, `leaked cleartext JWT in ${path}`).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    }

    // Lock, reject wrong password, then unlock and verify round-trip.
    lockVault();
    await expect(unlockVault("wrong-master-password")).rejects.toThrow(/Incorrect master password/);
    expect(useAuthStore.getState().dek).toBeNull();

    await unlockVault(masterPassword);
    const projects = await loadProjects();
    expect(projects).toHaveLength(1);
    const cfg = await loadConnectionConfig(proj.id);
    expect(cfg.password).toBe(dbPassword);
    expect(cfg.host).toBe("db.internal");
  });

  it("runs a full SQLite extraction, writes manifest with SHA-256 hashes, and lists snapshots in history", async () => {
    await createVaultUser("alice", "Master-Pass-1234", 1_000);
    const sqliteBytes = await buildSampleSqliteBytes();

    const proj = await createProject({
      name: "Shop Local",
      engine: "sqlite",
      tags: ["local"],
      connection: { database: "shop" },
    });

    const fixedDate = new Date("2026-10-19T14:32:08.000Z");
    const { dir, manifest, runId } = await runExtraction(
      proj.id,
      DEFAULT_EXTRACTION_OPTIONS,
      () => {},
      { sqliteBytes },
      fixedDate,
    );

    expect(dir).toBe("exports/Shop_Local/shop/2026-10-19/2026-10-19T14-32-08Z");
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(await mem.exists(`${dir}/${f.path}`)).toBe(true);
    }

    const snapshots = await listSnapshots(proj.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].runId).toBe(runId);
    expect(snapshots[0].partial).toBe(false);

    const zipBytes = await buildSnapshotZip(dir, manifest);
    expect(zipBytes.byteLength).toBeGreaterThan(200);

    const updatedProj = useProjectStore.getState().get(proj.id);
    expect(updatedProj?.lastExtractedAt).toBe("2026-10-19T14:32:08.000Z");
  });

  it("redacts passwords, connection URIs, Bearer tokens, and JWTs from logs", () => {
    registerSecretForRedaction("MyLiteralDbPass!");
    logger.error(
      "test",
      "Failed connecting to postgres://admin:UriPass123@10.0.0.1:5432/db with password=InlinePass99 and MyLiteralDbPass! token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      { password: "ObjSecretValue", nested: { token: "Bearer abcdef123456" } },
    );

    const serialized = JSON.stringify(useLogStore.getState().entries);
    expect(serialized).not.toContain("UriPass123");
    expect(serialized).not.toContain("InlinePass99");
    expect(serialized).not.toContain("MyLiteralDbPass!");
    expect(serialized).not.toContain("ObjSecretValue");
    expect(serialized).not.toContain("abcdef123456");
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialized).toContain("[REDACTED]");
  });
});
