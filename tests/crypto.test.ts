import { describe, expect, it } from "vitest";
import { decrypt, DecryptionError, encrypt } from "@/lib/crypto/aesgcm";
import { signJwt, verifyJwt } from "@/lib/crypto/jwt";
import {
  checkVerifier,
  createVerifier,
  deriveMasterKey,
  generateRawDek,
  generateSalt,
  importDekKeys,
  unwrapDek,
  wrapDek,
} from "@/lib/crypto/kdf";
import { seal, unseal } from "@/lib/crypto/vault";
import { fromBase64, toBase64 } from "@/lib/utils/encoding";

const TEST_ITERATIONS = 1_000;

describe("lib/crypto", () => {
  it("derives a master key, verifies the right password, and rejects a wrong one", async () => {
    const salt = generateSalt();
    const mkRight = await deriveMasterKey("correct-horse-battery-staple", salt, TEST_ITERATIONS);
    const verifier = await createVerifier(mkRight);

    expect(await checkVerifier(mkRight, verifier)).toBe(true);

    const mkWrong = await deriveMasterKey("wrong-password", salt, TEST_ITERATIONS);
    expect(await checkVerifier(mkWrong, verifier)).toBe(false);
  });

  it("wraps and unwraps a DEK into non-extractable AES + HMAC keys and zeroes the raw buffer", async () => {
    const mk = await deriveMasterKey("pass-123456", generateSalt(), TEST_ITERATIONS);
    const raw = generateRawDek();
    const wrapped = await wrapDek(mk, raw, "dek-test");

    const keys = await unwrapDek(mk, wrapped);
    expect(keys.kid).toBe("dek-test");
    expect(keys.aes.extractable).toBe(false);
    expect(keys.hmac.extractable).toBe(false);

    const rawCopy = generateRawDek();
    await importDekKeys(rawCopy, "dek-test");
    expect(rawCopy.every((b) => b === 0)).toBe(true);
  });

  it("rejects unwrapping a DEK with the wrong master key", async () => {
    const salt = generateSalt();
    const mk1 = await deriveMasterKey("pass-one", salt, TEST_ITERATIONS);
    const mk2 = await deriveMasterKey("pass-two", salt, TEST_ITERATIONS);
    const wrapped = await wrapDek(mk1, generateRawDek(), "dek-1");

    await expect(unwrapDek(mk2, wrapped)).rejects.toThrow(DecryptionError);
  });

  it("encrypts and decrypts an AES-GCM envelope and rejects tampered ciphertext or IV", async () => {
    const keys = await importDekKeys(generateRawDek(), "dek-1");
    const env = await encrypt(keys.aes, "hello vault", "dek-1");

    expect(env).toMatchObject({ v: 1, alg: "AES-GCM", kid: "dek-1" });
    expect(await decrypt(keys.aes, env)).toBe("hello vault");

    const ctBytes = fromBase64(env.ct);
    ctBytes[0] ^= 0xff;
    await expect(decrypt(keys.aes, { ...env, ct: toBase64(ctBytes) })).rejects.toThrow(DecryptionError);

    const ivBytes = fromBase64(env.iv);
    ivBytes[0] ^= 0xff;
    await expect(decrypt(keys.aes, { ...env, iv: toBase64(ivBytes) })).rejects.toThrow(DecryptionError);
  });

  it("signs and verifies an HS256 JWT and rejects a different key or tampered token", async () => {
    const k1 = await importDekKeys(generateRawDek(), "dek-1");
    const k2 = await importDekKeys(generateRawDek(), "dek-2");
    const token = await signJwt({ projectId: "p1", secret: "shh" }, k1.hmac, k1.kid);

    const verified = await verifyJwt<{ projectId: string; secret: string }>(token, k1.hmac);
    expect(verified.projectId).toBe("p1");
    expect(verified.secret).toBe("shh");

    await expect(verifyJwt(token, k2.hmac)).rejects.toThrow();
    await expect(verifyJwt(token.slice(0, -4) + "AAAA", k1.hmac)).rejects.toThrow();
  });

  it("seals and unseals a vault payload through both JWT and AES-GCM layers", async () => {
    const keys = await importDekKeys(generateRawDek(), "dek-1");
    const env = await seal(keys, { host: "127.0.0.1", password: "top-secret-password" });

    expect(JSON.stringify(env)).not.toContain("top-secret-password");
    expect(JSON.stringify(env)).not.toContain("127.0.0.1");

    const out = await unseal<{ host: string; password: string }>(keys, env);
    expect(out.host).toBe("127.0.0.1");
    expect(out.password).toBe("top-secret-password");
  });
});
