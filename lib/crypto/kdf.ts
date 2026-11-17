import { decrypt, decryptBytes, DecryptionError, encrypt, encryptBytes, type Envelope } from "./aesgcm";
import { randomBytes } from "@/lib/utils/encoding";

export const DEFAULT_ITERATIONS = 600_000;
export const SALT_BYTES = 32;
export const DEK_BYTES = 32;
const VERIFIER_CONSTANT = "HHP-OK";

/** In-memory key material for an unlocked vault. Never serialised. */
export interface DekKeys {
  /** AES-GCM key for vault envelopes. */
  aes: CryptoKey;
  /** HMAC-SHA256 key for HS256 JWTs. */
  hmac: CryptoKey;
  kid: string;
}

export function generateSalt(): Uint8Array<ArrayBuffer> {
  return randomBytes(SALT_BYTES);
}

export async function deriveMasterKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function createVerifier(masterKey: CryptoKey): Promise<Envelope> {
  return encrypt(masterKey, VERIFIER_CONSTANT);
}

export async function checkVerifier(masterKey: CryptoKey, verifier: Envelope): Promise<boolean> {
  try {
    return (await decrypt(masterKey, verifier)) === VERIFIER_CONSTANT;
  } catch (err) {
    if (err instanceof DecryptionError) return false;
    throw err;
  }
}

export function generateRawDek(): Uint8Array<ArrayBuffer> {
  return randomBytes(DEK_BYTES);
}

export function wrapDek(masterKey: CryptoKey, rawDek: Uint8Array<ArrayBuffer>, kid: string): Promise<Envelope> {
  return encryptBytes(masterKey, rawDek, kid);
}

/**
 * Imports the raw DEK as two non-extractable keys and zeroes the raw bytes afterwards.
 */
export async function importDekKeys(rawDek: Uint8Array<ArrayBuffer>, kid: string): Promise<DekKeys> {
  try {
    const aes = await crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const hmac = await crypto.subtle.importKey("raw", rawDek, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    return { aes, hmac, kid };
  } finally {
    rawDek.fill(0);
  }
}

export async function unwrapDek(masterKey: CryptoKey, envelope: Envelope): Promise<DekKeys> {
  const raw = await decryptBytes(masterKey, envelope);
  if (raw.length !== DEK_BYTES) {
    raw.fill(0);
    throw new DecryptionError("Wrapped DEK has an unexpected length");
  }
  return importDekKeys(raw, envelope.kid ?? "dek-1");
}
