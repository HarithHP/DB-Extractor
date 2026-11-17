import type { JWTPayload } from "jose";
import { decrypt, encrypt, isEnvelope, type Envelope } from "./aesgcm";
import { signJwt, verifyJwt } from "./jwt";
import type { DekKeys } from "./kdf";

/** Two-layer seal: sign the payload as an HS256 JWT, then encrypt the JWT with AES-GCM. */
export async function seal(keys: DekKeys, payload: JWTPayload): Promise<Envelope> {
  const jwt = await signJwt(payload, keys.hmac, keys.kid);
  return encrypt(keys.aes, jwt, keys.kid);
}

export async function unseal<T = Record<string, unknown>>(keys: DekKeys, env: unknown): Promise<T> {
  if (!isEnvelope(env)) throw new Error("Vault file is not a valid envelope");
  const jwt = await decrypt(keys.aes, env);
  return (await verifyJwt<Record<string, unknown>>(jwt, keys.hmac)) as T;
}
