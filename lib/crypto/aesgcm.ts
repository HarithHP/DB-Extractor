import { fromBase64, randomBytes, toBase64 } from "@/lib/utils/encoding";

export type Envelope = {
  v: 1;
  alg: "AES-GCM";
  iv: string;
  ct: string;
  kid?: string;
};

export class DecryptionError extends Error {
  constructor(message = "Decryption failed: wrong key or corrupted data") {
    super(message);
    this.name = "DecryptionError";
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return e.v === 1 && e.alg === "AES-GCM" && typeof e.iv === "string" && typeof e.ct === "string";
}

export async function encryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>, kid?: string): Promise<Envelope> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const env: Envelope = { v: 1, alg: "AES-GCM", iv: toBase64(iv), ct: toBase64(ct) };
  if (kid) env.kid = kid;
  return env;
}

export async function decryptBytes(key: CryptoKey, env: Envelope): Promise<Uint8Array<ArrayBuffer>> {
  if (!isEnvelope(env)) throw new DecryptionError("Unsupported or malformed envelope");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(env.iv) }, key, fromBase64(env.ct));
    return new Uint8Array(pt);
  } catch {
    throw new DecryptionError();
  }
}

export async function encrypt(key: CryptoKey, plaintext: string, kid?: string): Promise<Envelope> {
  return encryptBytes(key, enc.encode(plaintext), kid);
}

export async function decrypt(key: CryptoKey, env: Envelope): Promise<string> {
  return dec.decode(await decryptBytes(key, env));
}
